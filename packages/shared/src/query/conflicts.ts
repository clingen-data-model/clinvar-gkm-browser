// Conflicts (docs/api.md#three-resources-one-query-model, docs/data.md#conflicts): the pair
// base, each pair's conflict level, and each variant's conflict status. Pairs are computed per
// query from the filtered SCVs, so every conflict view (scorecards, grids, lists) reads the same
// pairs and agrees.

import { z } from 'zod';
import type { AppliedFilter, FilterOptions } from './filters.ts';
import type { SqlParams } from './sql.ts';
import { PAIR_SIDE_COLUMNS, pairFilterWhere } from './where.ts';

export { PAIR_SIDE_COLUMNS } from './where.ts';

/** What the pair CTE needs from a parsed query. */
export interface PairInput {
  filters: readonly AppliedFilter[];
  filterOptions: FilterOptions;
  pair: PairOptions;
}

/** ClinVar Miner's conflict scale, on ClinGen's significance groups (bq-tools). */
export const CONFLICT_LEVELS = [
  { level: 0, label: 'No conflict', example: 'pathogenic and pathogenic' },
  { level: 1, label: 'Synonymous', example: 'two spellings of the same term' },
  { level: 2, label: 'Confidence', example: 'benign and likely benign; VUS and VUS-high' },
  { level: 3, label: 'Benign or likely benign vs uncertain', example: 'likely benign and VUS' },
  {
    level: 4,
    label: 'Category',
    example: 'none: risk factor, drug response and the other types are never compared',
  },
  {
    level: 5,
    label: 'Clinically significant',
    example: 'pathogenic or likely pathogenic and VUS, likely benign or benign',
  },
] as const;

/** A variant's conflict status: no partner to compare, all agree, or its highest pair level. */
export const CONFLICT_STATUSES = [
  { status: 'single', label: 'One submission (nothing to compare)' },
  { status: 'none', label: 'Submissions agree' },
  { status: 'na', label: 'Not compared (classification type never conflicts)' },
  ...CONFLICT_LEVELS.filter((l) => l.level > 0).map((l) => ({
    status: String(l.level),
    label: l.label,
  })),
] as const;

export const ConditionMatch = z.enum(['strict', 'wildcard', 'any']);
export type ConditionMatch = z.infer<typeof ConditionMatch>;

export const CONDITION_MATCH_LABELS: Record<ConditionMatch, string> = {
  strict: 'Same condition',
  wildcard: 'Same condition, or not provided/not specified',
  any: 'Any condition',
};

export interface PairOptions {
  conditionMatch: ConditionMatch;
  /** Leave flagged SCVs out of pairs (they're still listed everywhere else). */
  excludeFlagged: boolean;
  /** Pairs from two different submitters only; false to compare a lab with itself. */
  distinctSubmitters: boolean;
  /** Pairs at or above this level (pairs), or variants whose status is at or above it (variants). */
  minLevel: number | null;
  /** Pair levels (pairs), or variant statuses (variants), to keep. */
  levels: string[] | null;
  /** Pairs whose two terms are these, in either order (a cell of a term grid without sides). */
  terms: [string, string] | null;
  /**
   * Whether the sides differ. With side filters, A is one side and B the other. Without, each
   * pair appears once, oriented so A has the lower term code (then the lower SCV id): a.term and
   * b.term then cross into one triangle with each unordered pair of terms in one cell, and
   * a./b. dimensions other than term are arbitrary.
   */
  directed: boolean;
}

/**
 * CTE pairs: the stored pairs (scv_classification_pair, built by the derivation with each pair's
 * level and condition flags) that the request compares, as a filtered read with no join. Its
 * columns: variation_id, classification_type, level, and a_/b_ for each of PAIR_SIDE_COLUMNS.
 */
export function pairCtes(input: PairInput, params: SqlParams): string {
  const options = input.pair;
  const where = [
    pairFilterWhere(input.filters, input.filterOptions, params, 'a'),
    pairFilterWhere(input.filters, input.filterOptions, params, 'b'),
  ];
  if (options.conditionMatch === 'strict') where.push('p.same_condition');
  if (options.conditionMatch === 'wildcard') {
    where.push('(p.same_condition OR p.unspecified_condition)');
  }
  if (options.excludeFlagged) {
    where.push(`p.a_submission_level <> 'FLAG'`, `p.b_submission_level <> 'FLAG'`);
  }
  if (options.distinctSubmitters) where.push('p.a_submitter_id <> p.b_submitter_id');
  // Both orders are stored; without sides, keep one, A having the lower term (then SCV id).
  if (!options.directed) {
    where.push(`(coalesce(p.a_term, '') < coalesce(p.b_term, '')
      OR (coalesce(p.a_term, '') = coalesce(p.b_term, '') AND p.a_scv_id < p.b_scv_id))`);
  }
  const sides = (x: 'a' | 'b') =>
    PAIR_SIDE_COLUMNS.map((c) => `p.${x}_${c} AS ${x}_${c}`).join(', ');
  return `pairs AS (
      SELECT p.variation_id AS variation_id, p.classification_type AS classification_type,
             p.level AS level, ${sides('a')}, ${sides('b')}
      FROM scv_classification_pair p
      WHERE ${where.join('\n        AND ')}
    )`;
}

/** WHERE over pairs for the level options. */
export function pairLevelWhere(options: PairOptions, params: SqlParams): string {
  const parts: string[] = [];
  if (options.minLevel !== null) parts.push(`level >= ${params.add(options.minLevel)}`);
  if (options.levels !== null) parts.push(`level::VARCHAR IN (${params.list(options.levels)})`);
  if (options.terms !== null) {
    const [x, y] = options.terms.map((t) => params.add(t));
    parts.push(
      `((a_term = ${x ?? 'NULL'} AND b_term = ${y ?? 'NULL'}) OR (a_term = ${y ?? 'NULL'} AND b_term = ${x ?? 'NULL'}))`,
    );
  }
  return parts.length === 0 ? 'true' : parts.join(' AND ');
}

/**
 * CTE statuses: each variant (and classification type) with an SCV matching side A's filters, in
 * CTE `members`, and its conflict status against side B: `single` (no partner), `none` (all
 * agree), its highest pair level '1' to '5', or `na` for a type that never conflicts. The pairs
 * are reduced to one row per variant first, so the join to members is with that, not every pair.
 */
export const STATUS_CTE = `pair_status AS (
    SELECT variation_id, classification_type, max(level) AS max_level, count(level) AS pair_count
    FROM pairs GROUP BY variation_id, classification_type
  ),
  statuses AS (
    SELECT m.variation_id AS variation_id, m.classification_type AS classification_type,
           CASE WHEN NOT t.conflict_detectable THEN 'na'
                WHEN ps.max_level IS NULL THEN 'single'
                WHEN ps.max_level = 0 THEN 'none'
                ELSE ps.max_level::VARCHAR END AS conflict_level,
           coalesce(ps.max_level, -1) AS level_rank,
           coalesce(ps.pair_count, 0)::INTEGER AS pair_count
    FROM members m
    JOIN classification_type t ON t.code = m.classification_type
    LEFT JOIN pair_status ps ON ps.variation_id = m.variation_id AND ps.classification_type = m.classification_type
  )`;

/** WHERE over statuses for the level options (minLevel: '1'..'5' at or above). */
export function statusWhere(options: PairOptions, params: SqlParams): string {
  const parts: string[] = [];
  if (options.minLevel !== null) parts.push(`level_rank >= ${params.add(options.minLevel)}`);
  if (options.levels !== null) parts.push(`conflict_level IN (${params.list(options.levels)})`);
  return parts.length === 0 ? 'true' : parts.join(' AND ');
}
