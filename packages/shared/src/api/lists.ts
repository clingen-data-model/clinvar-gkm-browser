// List and summary envelopes (docs/api.md#lists-paging-sorting-fields, #summaries).
import { z } from 'zod';
import { ReleaseDate } from './release.ts';

/** The request in canonical form: defaults filled in, values normalized. */
export const QueryEcho = z.record(z.string(), z.array(z.string()));

export const Page = z.object({
  limit: z.int(),
  offset: z.int(),
  /** Present when the request asked for count=true (lists) or always (summaries). */
  total: z.int().nullable(),
});

export function list<T extends z.ZodType>(row: T) {
  return z.object({ release: ReleaseDate, query: QueryEcho, data: z.array(row), page: Page });
}

export const SummaryDimension = z.object({
  name: z.string(),
  label: z.string(),
  /** Labels for the keys that appear in rows, where keys aren't their own labels. */
  labels: z.record(z.string(), z.string()),
});

export const SummaryResponse = z.object({
  release: ReleaseDate,
  query: QueryEcho,
  dimensions: z.array(SummaryDimension),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))),
  totals: z.record(z.string(), z.number()),
  page: Page,
  /**
   * Pairs and variants: flagged SCVs (on side A) left out of the comparison, so a page can say
   * so (flagged=exclude, the default). Null where nothing was left out or it doesn't apply.
   */
  flaggedExcluded: z.int().nullable(),
});
export type SummaryResponse = z.infer<typeof SummaryResponse>;
