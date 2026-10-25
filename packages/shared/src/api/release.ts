import { z } from 'zod';

/** ClinVar release dates name releases everywhere: paths on disk, the `release` parameter. */
export const ReleaseDate = z.iso.date();

export const ReleaseTable = z.object({ name: z.string(), rows: z.int() });

/** One derived release on disk, from its manifest.json. */
export const Release = z.object({
  clinvarRelease: ReleaseDate,
  parquetBuildDate: z.string(),
  gkmSchemaVersion: z.string(),
  gkmDataset: z.string(),
  derivedSchema: z.int(),
  loadedAt: z.string(),
  tables: z.array(ReleaseTable),
});
export type Release = z.infer<typeof Release>;

export const ReleaseList = z.object({
  /** The release served when a request names none. */
  current: ReleaseDate.nullable(),
  data: z.array(Release),
});
export type ReleaseList = z.infer<typeof ReleaseList>;

/** Every endpoint that reads release data accepts `release`; absent means the current one. */
export const ReleaseQuery = z.object({ release: ReleaseDate.optional() });

/** The envelope of a single-item response: the item, and the release it came from. */
export function item<T extends z.ZodType>(data: T) {
  return z.object({ release: ReleaseDate, data });
}
