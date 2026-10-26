// Derived releases on disk: $CLINVAR_DATA_DIR/derived/<schema>/<release>/, each a directory of
// parquet tables with a manifest.json written by the derivation (docs/schema.md#running-it).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Release } from '@cvb/shared/api';
import { z } from 'zod';

/** The derived schema version this server reads. Releases of other versions are ignored. */
export const DERIVED_SCHEMA = 1;

const Manifest = z
  .object({
    clinvar_release: z.iso.date(),
    parquet_build_date: z.string(),
    gkm_schema_version: z.string(),
    gkm_dataset: z.string(),
    derived_schema: z.int(),
    loaded_at: z.string(),
    // Table names become view names in SQL, so they must be plain identifiers.
    tables: z.array(z.object({ name: z.string().regex(/^[a-z_][a-z0-9_]*$/), rows: z.int() })),
  })
  .transform(
    (m): Release => ({
      clinvarRelease: m.clinvar_release,
      parquetBuildDate: m.parquet_build_date,
      gkmSchemaVersion: m.gkm_schema_version,
      gkmDataset: m.gkm_dataset,
      derivedSchema: m.derived_schema,
      loadedAt: m.loaded_at,
      tables: m.tables,
    }),
  );

export interface ReleaseOnDisk {
  release: Release;
  dir: string;
}

export interface SkippedRelease {
  dir: string;
  reason: string;
}

/**
 * Every complete derived release, oldest first, and the directories skipped as incomplete or
 * invalid (a truncated manifest, a missing table file), so one bad directory can't keep the
 * others from being served. Directories without a manifest (a derivation in progress, a
 * `.old` copy) are ignored without comment.
 */
export function findReleases(dataDir: string): {
  releases: ReleaseOnDisk[];
  skipped: SkippedRelease[];
} {
  const base = join(dataDir, 'derived', String(DERIVED_SCHEMA));
  const releases: ReleaseOnDisk[] = [];
  const skipped: SkippedRelease[] = [];
  if (!existsSync(base)) return { releases, skipped };
  for (const name of readdirSync(base).sort()) {
    const dir = join(base, name);
    const manifestPath = join(dir, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      skipped.push({ dir, reason: `unreadable manifest.json: ${String(error)}` });
      continue;
    }
    const parsed = Manifest.safeParse(json);
    if (!parsed.success) {
      skipped.push({ dir, reason: `invalid manifest.json: ${z.prettifyError(parsed.error)}` });
      continue;
    }
    if (parsed.data.clinvarRelease !== name) {
      skipped.push({ dir, reason: `manifest is for release ${parsed.data.clinvarRelease}` });
      continue;
    }
    const missing = parsed.data.tables.filter((t) => !existsSync(join(dir, `${t.name}.parquet`)));
    if (missing.length > 0) {
      skipped.push({ dir, reason: `missing ${missing.map((t) => `${t.name}.parquet`).join(', ')}` });
      continue;
    }
    releases.push({ release: parsed.data, dir });
  }
  return { releases, skipped };
}
