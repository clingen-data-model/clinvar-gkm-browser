// Conflicts (docs/api.md#three-resources-one-query-model, docs/data.md#conflicts): the pair
// base, each pair's conflict level, and each variant's conflict status. Pairs are computed per
// query from the filtered SCVs, so every conflict view (scorecards, grids, lists) reads the same
// pairs and agrees.

import { z } from 'zod';
import type { SqlParams } from './sql.ts';

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
  /**
   * Whether the sides differ. Without side filters, each pair appears once (a.scv_id <
   * b.scv_id); with them, A is one side and B the other.
   */
  directed: boolean;
}

/** A pair's conflict level from its two SCVs (`a`, `b`) and their terms (`ta`, `tb`). */
const LEVEL_SQL = `CASE
    WHEN ta.significance IS NULL OR tb.significance IS NULL THEN NULL
    WHEN (ta.significance = 2) <> (tb.significance = 2) THEN 5
    WHEN ta.significance <> tb.significance THEN 3
    WHEN a.term <> b.term THEN 2
    WHEN lower(a.classification) <> lower(b.classification) THEN 1
    ELSE 0
  END`;

const CONDITION_SQL: Record<ConditionMatch, string> = {
  strict: 'list_has_any(a.condition_ids, b.condition_ids)',
  wildcard:
    '(a.condition_unspecified OR b.condition_unspecified OR list_has_any(a.condition_ids, b.condition_ids))',
  any: 'true',
};

/** The SCV columns a pair carries for each side, as a_<column> and b_<column>. */
export const PAIR_SIDE_COLUMNS = [
  'scv_id',
  'submitter_id',
  'term',
  'classification',
  'review_status',
  'submission_level',
  'collection_methods',
  'date_last_evaluated',
  'date_submitted',
] as const;

const SIDE_SELECT = `s.scv_id, s.variation_id, s.submitter_id, s.classification_type, s.term,
  s.classification, s.review_status, s.submission_level, s.collection_methods,
  s.date_last_evaluated, s.date_submitted, s.condition_ids, s.condition_unspecified`;

/**
 * CTEs side_a, side_b and pairs. `whereA` and `whereB` are each side's filters over `scv s`.
 * Only conflict-detectable classification types pair (pathogenicity, oncogenicity).
 */
export function pairCtes(whereA: string, whereB: string, options: PairOptions): string {
  const flagged = options.excludeFlagged ? ` AND s.submission_level <> 'FLAG'` : '';
  const detectable = ` AND s.classification_type IN (SELECT code FROM classification_type WHERE conflict_detectable)`;
  const order = options.directed ? 'a.scv_id <> b.scv_id' : 'a.scv_id < b.scv_id';
  const submitters = options.distinctSubmitters ? ' AND a.submitter_id <> b.submitter_id' : '';
  const sides = (x: 'a' | 'b') => PAIR_SIDE_COLUMNS.map((c) => `${x}.${c} AS ${x}_${c}`).join(', ');
  return `side_a AS (SELECT ${SIDE_SELECT} FROM scv s WHERE (${whereA})${flagged}${detectable}),
    side_b AS (SELECT ${SIDE_SELECT} FROM scv s WHERE (${whereB})${flagged}${detectable}),
    pairs AS (
      SELECT a.variation_id, a.classification_type, ${LEVEL_SQL} AS level, ${sides('a')}, ${sides('b')}
      FROM side_a a
      JOIN side_b b ON b.variation_id = a.variation_id AND b.classification_type = a.classification_type
      LEFT JOIN classification_term ta ON ta.classification_type = a.classification_type AND ta.term = a.term
      LEFT JOIN classification_term tb ON tb.classification_type = b.classification_type AND tb.term = b.term
      WHERE ${order}${submitters} AND ${CONDITION_SQL[options.conditionMatch]}
    )`;
}

/** WHERE over pairs for the level options. */
export function pairLevelWhere(options: PairOptions, params: SqlParams): string {
  const parts: string[] = [];
  if (options.minLevel !== null) parts.push(`level >= ${params.add(options.minLevel)}`);
  if (options.levels !== null) parts.push(`level::VARCHAR IN (${params.list(options.levels)})`);
  return parts.length === 0 ? 'true' : parts.join(' AND ');
}

/**
 * CTE statuses: each variant (and classification type) with an SCV matching side A's filters, in
 * CTE `members`, and its conflict status against side B: `single` (no partner), `none` (all
 * agree), its highest pair level '1' to '5', or `na` for a type that never conflicts.
 */
export const STATUS_CTE = `statuses AS (
    SELECT m.variation_id, m.classification_type,
           CASE WHEN NOT t.conflict_detectable THEN 'na'
                WHEN max(p.level) IS NULL THEN 'single'
                WHEN max(p.level) = 0 THEN 'none'
                ELSE max(p.level)::VARCHAR END AS conflict_level,
           coalesce(max(p.level), -1) AS level_rank,
           count(p.level)::INTEGER AS pair_count
    FROM members m
    JOIN classification_type t ON t.code = m.classification_type
    LEFT JOIN pairs p ON p.variation_id = m.variation_id AND p.classification_type = m.classification_type
    GROUP BY m.variation_id, m.classification_type, t.conflict_detectable
  )`;

/** WHERE over statuses for the level options (minLevel: '1'..'5' at or above). */
export function statusWhere(options: PairOptions, params: SqlParams): string {
  const parts: string[] = [];
  if (options.minLevel !== null) parts.push(`level_rank >= ${params.add(options.minLevel)}`);
  if (options.levels !== null) parts.push(`conflict_level IN (${params.list(options.levels)})`);
  return parts.length === 0 ? 'true' : parts.join(' AND ');
}
