// /api/v1/search: what the input looks like decides where to look (docs/search.md).
import { z } from 'zod';

export const SearchKind = z.enum(['variant', 'scv', 'gene', 'condition', 'submitter']);
export type SearchKind = z.infer<typeof SearchKind>;

export const SearchResult = z.object({
  kind: SearchKind,
  id: z.int(),
  label: z.string(),
  /** Why it matched, e.g. "rsID rs80357914" or "alias Familial cancer of breast". */
  match: z.string(),
});
export type SearchResult = z.infer<typeof SearchResult>;

export const SearchResponse = z.object({
  release: z.iso.date(),
  q: z.string(),
  /** What the input was recognized as: an accession, rsID, HGVS, ... or a name. */
  recognizedAs: z.string(),
  results: z.array(SearchResult),
});
export type SearchResponse = z.infer<typeof SearchResponse>;

export const SearchQuery = z.object({
  q: z.string().trim().min(1).max(300),
  release: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
