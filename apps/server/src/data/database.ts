// The query engine: one in-memory DuckDB instance with a schema of views per derived release,
// each view reading one parquet file. A query names its release and runs on its own connection
// with that schema on the search path, under a timeout.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DuckDBInstance, type DuckDBValue } from '@duckdb/node-api';
import type { ReleaseOnDisk, SkippedRelease } from './releases.ts';

export type Row = Record<string, unknown>;

export class UnknownReleaseError extends Error {
  readonly statusCode = 404;
  constructor(release: string) {
    super(`Release ${release} is not available.`);
  }
}

export class NoDataError extends Error {
  readonly statusCode = 503;
  constructor() {
    super('No ClinVar release has been downloaded and derived yet.');
  }
}

export class QueryTimeoutError extends Error {
  readonly statusCode = 503;
  constructor(timeoutMs: number) {
    super(`The query took longer than ${timeoutMs / 1000} s and was stopped.`);
  }
}

export interface DatabaseOptions {
  dataDir: string;
  memoryLimit: string;
  threads: number;
  queryTimeoutMs: number;
  /** The release served when a request names none; null for the newest. */
  pinnedRelease: string | null;
}

/** Schema name for a release: 2026-10-18 -> r2026_10_18. */
function schemaName(release: string): string {
  return `r${release.replaceAll('-', '_')}`;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export class Database {
  private readonly releases = new Map<string, ReleaseOnDisk>();
  private current: string | null = null;
  private readonly instance: DuckDBInstance;
  private readonly options: DatabaseOptions;

  private constructor(instance: DuckDBInstance, options: DatabaseOptions) {
    this.instance = instance;
    this.options = options;
  }

  /**
   * Opens DuckDB and registers the releases. A release whose views can't be created (an
   * unreadable parquet file) is left out and reported through `onSkip`, so the rest are served.
   */
  static async open(
    options: DatabaseOptions,
    releases: ReleaseOnDisk[],
    onSkip: (skipped: SkippedRelease) => void = () => undefined,
  ): Promise<Database> {
    const spill = join(options.dataDir, 'tmp', 'duckdb');
    mkdirSync(spill, { recursive: true });
    const instance = await DuckDBInstance.create(':memory:', {
      memory_limit: options.memoryLimit,
      threads: String(options.threads),
      temp_directory: spill,
      // Never fetch extensions at run time: offline and in a locked-down container that fails.
      autoinstall_known_extensions: 'false',
      autoload_known_extensions: 'false',
    });
    // Keep parquet footers in memory between queries; a global setting, so set once.
    const connection = await instance.connect();
    try {
      await connection.run('SET GLOBAL parquet_metadata_cache = true');
    } finally {
      connection.closeSync();
    }
    const db = new Database(instance, options);
    for (const release of releases) {
      try {
        await db.addRelease(release);
      } catch (error) {
        onSkip({ dir: release.dir, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    return db;
  }

  /** Registers a release's views. Called at startup, and when a new release is derived. */
  async addRelease(onDisk: ReleaseOnDisk): Promise<void> {
    const date = onDisk.release.clinvarRelease;
    const schema = schemaName(date);
    const connection = await this.instance.connect();
    try {
      await connection.run(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
      for (const table of onDisk.release.tables) {
        const path = join(onDisk.dir, `${table.name}.parquet`);
        await connection.run(
          `CREATE OR REPLACE VIEW ${schema}.${table.name} AS FROM read_parquet(${sqlString(path)})`,
        );
      }
    } catch (error) {
      // Leave no half-registered release behind.
      await connection.run(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      throw error;
    } finally {
      connection.closeSync();
    }
    this.releases.set(date, onDisk);
    this.current = this.pickCurrent();
  }

  private pickCurrent(): string | null {
    const pinned = this.options.pinnedRelease;
    if (pinned !== null && this.releases.has(pinned)) return pinned;
    const dates = [...this.releases.keys()].sort();
    return dates.at(-1) ?? null;
  }

  /** Releases available, oldest first, and the one served by default. */
  available(): { current: string | null; releases: ReleaseOnDisk[] } {
    const releases = [...this.releases.values()].sort((a, b) =>
      a.release.clinvarRelease.localeCompare(b.release.clinvarRelease),
    );
    return { current: this.current, releases };
  }

  /** The release a request asked for, or the current one; throws if it isn't available. */
  resolve(requested: string | undefined): string {
    if (requested !== undefined) {
      if (!this.releases.has(requested)) throw new UnknownReleaseError(requested);
      return requested;
    }
    if (this.current === null) throw new NoDataError();
    return this.current;
  }

  /** Runs one statement against a release, with positional parameters ($1, $2, ...). */
  async query(release: string, sql: string, params: DuckDBValue[] = []): Promise<Row[]> {
    const connection = await this.instance.connect();
    const timer = setTimeout(() => {
      connection.interrupt();
    }, this.options.queryTimeoutMs);
    try {
      await connection.run(`SET search_path = ${sqlString(schemaName(release))}`);
      const reader = await connection.runAndReadAll(sql, params);
      return reader.getRowObjectsJson();
    } catch (error) {
      if (error instanceof Error && /interrupt/i.test(error.message)) {
        throw new QueryTimeoutError(this.options.queryTimeoutMs);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      connection.closeSync();
    }
  }

  close(): void {
    this.instance.closeSync();
  }
}
