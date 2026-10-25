// Conflict views' shared state: the comparison options in the URL (the same names as the API's
// parameters), and conflict levels for a term grid's cells, by the same rule as the server
// (docs/data.md#conflicts).

import type { Vocabularies } from '@cvb/shared/api';
import { z } from 'zod';
import type { Params } from './api/client.ts';

const optional = z.string().optional().catch(undefined);

/** Search params of every conflict view. Names are the API's, so they pass straight through. */
export const ConflictSearch = z.object({
  condition_match: z.enum(['strict', 'wildcard', 'any']).optional().catch(undefined),
  flagged: z.enum(['exclude', 'include']).optional().catch(undefined),
  'a.min_stars': optional,
  'b.min_stars': optional,
  'a.method': optional,
  'b.method': optional,
  /** A term grid cell's drill-down: a.term and b.term (directed) or terms (either order). */
  'a.term': optional,
  'b.term': optional,
  terms: optional,
  /** The pair list: all pairs, or conflicts only (the default). */
  show: z.enum(['conflicts', 'all']).optional().catch(undefined),
  labs_q: optional,
  labs_page: z.coerce.number().int().min(1).optional().catch(undefined),
  pairs_page: z.coerce.number().int().min(1).optional().catch(undefined),
  variants_page: z.coerce.number().int().min(1).optional().catch(undefined),
});
export type ConflictSearch = z.infer<typeof ConflictSearch>;

/** The comparison options as API parameters (not the drill-down or paging). */
export function comparisonParams(search: ConflictSearch): Params {
  return {
    condition_match: search.condition_match,
    flagged: search.flagged,
    'a.min_stars': search['a.min_stars'],
    'b.min_stars': search['b.min_stars'],
    'a.method': search['a.method'],
    'b.method': search['b.method'],
  };
}

type Term = Vocabularies['terms'][number];

/** A term grid key, `PATH:lp`, to its term. */
export function termOf(vocab: Vocabularies, key: string): Term | undefined {
  const [type, code] = key.split(':');
  return vocab.terms.find((t) => t.classificationType === type && t.term === code);
}

/** The conflict level two terms make, as the server computes it (level 1 needs the text). */
export function levelOf(a: Term | undefined, b: Term | undefined): number | null {
  if (a === undefined || b === undefined) return null;
  if ((a.significance === 2) !== (b.significance === 2)) return 5;
  if (a.significance !== b.significance) return 3;
  if (a.term !== b.term) return 2;
  return 0;
}

/** Background classes for a conflict level or variant status. */
export const LEVEL_CLASS: Record<string, string> = {
  single: 'bg-level-single',
  na: 'bg-level-single',
  none: 'bg-level-0',
  '0': 'bg-level-0',
  '1': 'bg-level-1',
  '2': 'bg-level-2',
  '3': 'bg-level-3',
  '4': 'bg-level-3',
  '5': 'bg-level-5',
};
