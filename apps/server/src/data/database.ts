// The query engine: one in-memory DuckDB instance with a schema of views per release, reading a
// derived release's parquet files or a release history's. A query names its release and runs on
// its own connection with that schema on the search path, under a timeout.

import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DuckDBInstance, type DuckDBValue } from '@duckdb/node-api';
import { z } from 'zod';
import { DERIVED_SCHEMA, type ReleaseOnDisk, type SkippedRelease } from './releases.ts';

export type Row = Record<string, unknown>;

/** A release that isn't served, with the releases that are (oldest first) for the response. */
export class UnknownReleaseError extends Error {
  readonly statusCode = 404;
  readonly releases: string[];
  constructor(release: string, releases: string[]) {
    super(
      `ClinVar release ${release} isn't served. The releases served are in \`releases\`, and GET /api/v1/releases lists them.`,
    );
    this.releases = releases;
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

/**
 * Schema name for a release: 2026-10-18 -> r2026_10_18 for a derived release, h2026_10_18 as read
 * from a history, so loading a history never touches a derived release's views.
 */
function schemaName(release: string, from: 'r' | 'h'): string {
  return `${from}${release.replaceAll('-', '_')}`;
}

/** A release served, and the schema its views are in. */
interface Served {
  onDisk: ReleaseOnDisk;
  schema: string;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** A row of a release history's releases.parquet. */
const HistoryRelease = z.object({
  release: z.iso.date(),
  dataset: z.string(),
  build_date: z.string(),
  schema_version: z.string(),
  applied_at: z.string(),
});

/** Table and column names become SQL identifiers, so they must be plain ones. */
function isIdentifier(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/** A history table's added or closed files, each partition's release as a column. */
function files(dir: string, kind: 'added' | 'closed', table: string): string {
  return `read_parquet(${sqlString(join(dir, kind, table, '*', '*.parquet'))}, hive_partitioning = true)`;
}

export class Database {
  private readonly releases = new Map<string, Served>();
  private current: string | null = null;
  private history = false;
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
    const schema = schemaName(date, 'r');
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
    this.releases.set(date, { onDisk, schema });
    this.current = this.pickCurrent();
  }

  /**
   * Registers every release in a release history (docs/history.md): for each, a schema whose views
   * read each table's rows as of that release from the history's files. A release here replaces a
   * derived release of the same date. Called once, at startup.
   *
   * All of it is built beside what's served and swapped in only once every part has loaded; if
   * any part fails, what was built is dropped and the derived releases are served as before.
   */
  async addHistory(dir: string): Promise<void> {
    if (this.history) throw new Error('a release history is already loaded');
    const connection = await this.instance.connect();
    const built = new Map<string, Served>();
    const created: string[] = [];
    try {
      const releases = HistoryRelease.array().parse(
        (
          await connection.runAndReadAll(
            `SELECT strftime(release, '%Y-%m-%d') AS release, dataset AS dataset, build_date AS build_date,
                    schema_version AS schema_version, CAST(applied_at AS VARCHAR) AS applied_at
             FROM read_parquet(${sqlString(join(dir, 'releases.parquet'))}) ORDER BY release`,
          )
        ).getRowObjectsJson(),
      );
      // A closings file names its rows by the table's natural key, plus valid_from and release.
      const tables: { name: string; key: string[] }[] = [];
      for (const name of readdirSync(join(dir, 'added')).filter(isIdentifier).sort()) {
        const columns = z
          .object({ name: z.string().refine(isIdentifier) })
          .array()
          .parse(
            (
              await connection.runAndReadAll(
                `SELECT column_name AS name FROM (DESCRIBE FROM ${files(dir, 'closed', name)})`,
              )
            ).getRowObjectsJson(),
          );
        const key = columns.map((c) => c.name).filter((c) => c !== 'valid_from' && c !== 'release');
        tables.push({ name, key });
      }
      const plain = readdirSync(join(dir, 'plain'))
        .filter((f) => f.endsWith('.parquet'))
        .map((f) => f.replace(/\.parquet$/, ''))
        .filter(isIdentifier)
        .sort();
      // Only the releases listed count. scripts/history.sh lists a release once its files are in,
      // so files of one being applied, or left by a failed apply, are of releases after the last.
      const last = releases.at(-1)?.release;
      if (last === undefined) throw new Error('the release history lists no releases');

      for (const r of releases) {
        const date = r.release;
        const schema = schemaName(date, 'h');
        await connection.run(`CREATE SCHEMA ${schema}`);
        created.push(schema);
        for (const { name, key } of tables) {
          const on = key.map((k) => `c.${k} IS NOT DISTINCT FROM a.${k}`).join(' AND ');
          await connection.run(
            `CREATE VIEW ${schema}.${name} AS
             SELECT a.* EXCLUDE (release) FROM ${files(dir, 'added', name)} a
             ANTI JOIN ${files(dir, 'closed', name)} c
               ON ${on} AND c.valid_from = a.release AND c.release <= DATE '${date}'
             WHERE a.release <= DATE '${date}'`,
          );
        }
        for (const name of plain) {
          await connection.run(
            `CREATE VIEW ${schema}.${name} AS FROM read_parquet(${sqlString(join(dir, 'plain', `${name}.parquet`))})`,
          );
        }
        await connection.run(
          `CREATE VIEW ${schema}.release AS
           SELECT release AS clinvar_release, build_date AS parquet_build_date, schema_version AS gkm_schema_version,
                  dataset AS gkm_dataset, ${DERIVED_SCHEMA} AS derived_schema, applied_at AS loaded_at
           FROM read_parquet(${sqlString(join(dir, 'releases.parquet'))}) WHERE release = DATE '${date}'`,
        );
        const counts = z
          .object({ name: z.string(), rows: z.coerce.number().int() })
          .array()
          .parse(
            (
              await connection.runAndReadAll(
                [...tables.map((t) => t.name), ...plain, 'release']
                  .map((name) => `SELECT '${name}' AS name, count(*) AS rows FROM ${schema}.${name}`)
                  .join(' UNION ALL ') + ' ORDER BY name',
              )
            ).getRowObjectsJson(),
          );
        built.set(date, {
          schema,
          onDisk: {
            dir,
            release: {
              clinvarRelease: date,
              parquetBuildDate: r.build_date,
              gkmSchemaVersion: r.schema_version,
              gkmDataset: r.dataset,
              derivedSchema: DERIVED_SCHEMA,
              loadedAt: r.applied_at,
              tables: counts,
            },
          },
        });
      }
      // Every row ever, with the releases it held in: the versions of a record.
      await connection.run('CREATE SCHEMA history');
      created.push('history');
      for (const { name, key } of tables) {
        const on = key.map((k) => `c.${k} IS NOT DISTINCT FROM a.${k}`).join(' AND ');
        await connection.run(
          `CREATE VIEW history.${name} AS
           SELECT a.* EXCLUDE (release), a.release AS valid_from, c.release AS valid_to
           FROM ${files(dir, 'added', name)} a
           LEFT JOIN ${files(dir, 'closed', name)} c
             ON ${on} AND c.valid_from = a.release AND c.release <= DATE '${last}'
           WHERE a.release <= DATE '${last}'`,
        );
      }
    } catch (error) {
      for (const schema of created) await connection.run(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      throw error;
    } finally {
      connection.closeSync();
    }
    for (const [date, served] of built) this.releases.set(date, served);
    this.history = true;
    this.current = this.pickCurrent();
  }

  /**
   * Whether a release history is loaded: then schema `history` has a view per table of every
   * row ever, with valid_from (its first release) and valid_to (the first without it, or NULL).
   */
  get hasHistory(): boolean {
    return this.history;
  }

  /**
   * SQL for every row of a table with valid_from and valid_to: from schema `history` when a
   * history is loaded, else the release's own rows, holding from that release on.
   */
  rowsEver(table: string): string {
    if (!isIdentifier(table)) throw new Error(`not a table name: ${table}`);
    return this.history
      ? `history.${table}`
      : `(SELECT *, (SELECT clinvar_release FROM release) AS valid_from, NULL::DATE AS valid_to FROM ${table})`;
  }

  /** The earliest release served, the start of what any version list can know. */
  earliest(): string | null {
    return [...this.releases.keys()].sort()[0] ?? null;
  }

  private pickCurrent(): string | null {
    const pinned = this.options.pinnedRelease;
    if (pinned !== null && this.releases.has(pinned)) return pinned;
    const dates = [...this.releases.keys()].sort();
    return dates.at(-1) ?? null;
  }

  /** Releases available, oldest first, and the one served by default. */
  available(): { current: string | null; releases: ReleaseOnDisk[] } {
    const releases = [...this.releases.values()]
      .map((served) => served.onDisk)
      .sort((a, b) => a.release.clinvarRelease.localeCompare(b.release.clinvarRelease));
    return { current: this.current, releases };
  }

  /**
   * The release a request asked for, or the current one. Only a release served answers: data
   * read as of one release but labelled with another date would mislead (docs/api.md).
   */
  resolve(requested: string | undefined): string {
    if (requested !== undefined) {
      if (this.releases.has(requested)) return requested;
      throw new UnknownReleaseError(requested, this.dates());
    }
    if (this.current === null) throw new NoDataError();
    return this.current;
  }

  private dates(): string[] {
    return [...this.releases.keys()].sort();
  }

  /** Runs one statement against a release, with positional parameters ($1, $2, ...). */
  async query(release: string, sql: string, params: DuckDBValue[] = []): Promise<Row[]> {
    const served = this.releases.get(release);
    if (served === undefined) throw new UnknownReleaseError(release, this.dates());
    const connection = await this.instance.connect();
    const timer = setTimeout(() => {
      connection.interrupt();
    }, this.options.queryTimeoutMs);
    try {
      await connection.run(`SET search_path = ${sqlString(served.schema)}`);
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
