// The filter registry (docs/api.md#filters). One vocabulary for every list and summary: each
// filter parses its URL values and compiles them to a predicate over a table of SCVs (`scv`, or
// one side of a pair), named by the context's alias. Filters on the variant (gene, variant type)
// are semi-joins on its variation_id, so they work unchanged for every resource. A filter is one
// entry here; routes don't change.
//
// In URLs, a repeated parameter means OR, different parameters mean AND, a `not.` prefix negates
// the whole filter, and on pair and variant resources an `a.` or `b.` prefix applies it to one
// side of a comparison (`not.a.submitter`).

import { z } from 'zod';
import type { SqlParams } from './sql.ts';

/** Options that modify filters rather than filter by themselves. */
export interface FilterOptions {
  geneRelationships: readonly GeneRelationship[];
}

/**
 * How a variant relates to a gene on its gene list, grouping ClinVar's relationship types. A gene
 * filter, grouping or page includes the chosen ones (docs/api.md, open question 2).
 */
export const GeneRelationship = z.enum(['single', 'overlap', 'spanning', 'near', 'asserted']);
export type GeneRelationship = z.infer<typeof GeneRelationship>;

export const GENE_RELATIONSHIPS: Record<
  GeneRelationship,
  { label: string; clinvarTypes: readonly string[] }
> = {
  single: { label: 'Within the gene only', clinvarTypes: ['within single gene'] },
  overlap: {
    label: 'Within the gene and an overlapping gene',
    clinvarTypes: ['within multiple genes by overlap'],
  },
  spanning: { label: 'Spanning the gene', clinvarTypes: ['genes overlapped by variant'] },
  near: { label: 'Near the gene', clinvarTypes: ['near gene, upstream', 'near gene, downstream'] },
  asserted: {
    label: 'Named by the submitter, not located by ClinVar',
    clinvarTypes: ['asserted, but not computed'],
  },
};

/**
 * Variants located within the gene. "overlap" matters as much as "single": HFE c.187C>G is
 * "multiple genes" only because HFE overlaps its antisense gene HFE-AS1. Large variants spanning
 * the gene, and variants near it, are opt-in.
 */
export const DEFAULT_GENE_RELATIONSHIPS: readonly GeneRelationship[] = ['single', 'overlap'];

/** The ClinVar relationship types for a set of relationships, or null for all of them. */
export function clinvarRelationshipTypes(
  relationships: readonly GeneRelationship[],
): string[] | null {
  if (GeneRelationship.options.every((r) => relationships.includes(r))) return null;
  return relationships.flatMap((r) => GENE_RELATIONSHIPS[r].clinvarTypes);
}

/** SQL mapping variant_gene.relationship_type to its GeneRelationship code. */
export const RELATIONSHIP_CODE_SQL = `CASE relationship_type
  ${Object.entries(GENE_RELATIONSHIPS)
    .flatMap(([code, r]) => r.clinvarTypes.map((t) => `WHEN '${t}' THEN '${code}'`))
    .join('\n  ')}
  END`;

export interface FilterContext {
  params: SqlParams;
  options: FilterOptions;
  /**
   * An SCV column's SQL: `s.submitter_id` over the scv table, or one side's column of a stored
   * pair (`p.a_submitter_id`). Throws MissingColumn for a column the source doesn't have.
   */
  col: (name: string) => string;
}

/** A filter needed a column its source doesn't carry (pairs carry most SCV columns, not all). */
export class MissingColumn extends Error {}

/** Columns of the scv table under an alias. */
export const scvColumns =
  (alias = 's') =>
  (name: string): string =>
    `${alias}.${name}`;

/** Which SCVs a filter applies to: all of them, or one side of a comparison. */
export type Side = 'both' | 'a' | 'b';

/** A filter with its values parsed: the canonical values for echoing, and its SQL. */
export interface AppliedFilter {
  name: string;
  side: Side;
  negate: boolean;
  values: string[];
  predicate: (ctx: FilterContext) => string;
}

export interface Filter {
  name: string;
  label: string;
  description: string;
  /**
   * Free-text values (review statuses, methods, comments) can contain commas, so they're never
   * split on them; give several by repeating the parameter. Other filters take `a,b` too.
   */
  text: boolean;
  /** Parses a filter's raw URL values, or returns the problem with the first bad one. */
  parse: (
    raw: readonly string[],
    negate: boolean,
    side?: Side,
  ) => AppliedFilter | { error: string };
}

interface FilterDef<T> {
  name: string;
  label: string;
  description: string;
  value: z.ZodType<T>;
  /** Single-valued filters (dates, minimums) take only one value. */
  single?: boolean;
  /** Free text, not split on commas (Filter.text). */
  text?: boolean;
  sql: (values: T[], ctx: FilterContext) => string;
}

function filter<T>(def: FilterDef<T>): Filter {
  return {
    name: def.name,
    label: def.label,
    description: def.description,
    text: def.text === true,
    parse(raw, negate, side = 'both') {
      if (raw.length === 0) return { error: `${def.name} needs a value.` };
      if (def.single === true && raw.length > 1) return { error: `${def.name} takes one value.` };
      const values: T[] = [];
      for (const r of raw) {
        const parsed = def.value.safeParse(r);
        if (!parsed.success) return { error: `${def.name}: invalid value '${r}'.` };
        values.push(parsed.data);
      }
      return {
        name: def.name,
        side,
        negate,
        values: values.map((v) => String(v)),
        predicate: (ctx) => {
          const sql = def.sql(values, ctx);
          return negate ? `NOT coalesce((${sql}), false)` : `(${sql})`;
        },
      };
    },
  };
}

const id = z.coerce.number().int().positive();
const date = z.iso.date();
const text = z.string().trim().min(1).max(200);
const yesNo = z.enum(['true', 'false']).transform((v) => v === 'true');

export const FILTERS: readonly Filter[] = [
  filter({
    name: 'variant',
    label: 'Variant',
    description: 'ClinVar variation ID.',
    value: id,
    sql: (v, { params, col }) => `${col('variation_id')} IN (${params.list(v)})`,
  }),
  filter({
    name: 'gene',
    label: 'Gene',
    description: "NCBI gene ID, through the variant's gene list (see gene_relationship).",
    value: id,
    sql: (v, { params, options, col }) => {
      const genes = params.list(v);
      const types = clinvarRelationshipTypes(options.geneRelationships);
      const relationship =
        types === null ? '' : ` AND relationship_type IN (${params.list(types)})`;
      return `${col('variation_id')} IN (SELECT variation_id FROM variant_gene WHERE gene_id IN (${genes})${relationship})`;
    },
  }),
  filter({
    name: 'variant_type',
    label: 'Variant type',
    description: "ClinVar's variation type, e.g. 'single nucleotide variant', 'Deletion'.",
    value: text,
    text: true,
    sql: (v, { params, col }) =>
      `${col('variation_id')} IN (SELECT variation_id FROM variant WHERE clinvar_variation_type IN (${params.list(v)}))`,
  }),
  filter({
    name: 'submitter',
    label: 'Submitter',
    description: 'ClinVar submitter (organization) ID.',
    value: id,
    sql: (v, { params, col }) => `${col('submitter_id')} IN (${params.list(v)})`,
  }),
  filter({
    name: 'classification_type',
    label: 'Classification type',
    description: "PATH (default), ONCO, SCI, DR, RF, ...; 'any' for all.",
    value: z
      .string()
      .regex(/^[A-Za-z]+$/)
      .transform((v) => v.toUpperCase()),
    sql: (v, { params, col }) =>
      v.includes('ANY') ? 'true' : `${col('classification_type')} IN (${params.list(v)})`,
  }),
  filter({
    name: 'term',
    label: 'Classification',
    description: 'Normalized term code, e.g. p, lp, vus, lb, b (see /api/v1/vocabularies/terms).',
    value: z.string().regex(/^[a-z0-9/-]+$/),
    sql: (v, { params, col }) => `${col('term')} IN (${params.list(v)})`,
  }),
  filter({
    name: 'bucket',
    label: 'Significance',
    description: 'P (P/LP), V (uncertain), B (B/LB), O (other), N (not provided).',
    value: z.enum(['P', 'V', 'B', 'O', 'N']),
    sql: (v, { params, col }) =>
      `(${col('classification_type')}, ${col('term')}) IN (SELECT classification_type, term FROM classification_term WHERE bucket IN (${params.list(v)}))`,
  }),
  filter({
    name: 'min_stars',
    label: 'Minimum stars',
    description: 'Minimum review status stars, 0 to 4.',
    value: z.coerce.number().int().min(0).max(4),
    single: true,
    sql: ([v], { params, col }) =>
      `${col('review_status')} IN (SELECT status FROM review_status WHERE stars >= ${params.add(v ?? 0)})`,
  }),
  filter({
    name: 'stars',
    label: 'Stars',
    description: 'Review status stars, 0 to 4.',
    value: z.coerce.number().int().min(0).max(4),
    sql: (v, { params, col }) =>
      `${col('review_status')} IN (SELECT status FROM review_status WHERE stars IN (${params.list(v)}))`,
  }),
  filter({
    name: 'review_status',
    label: 'Review status',
    description: "ClinVar's review status text.",
    value: text,
    text: true,
    sql: (v, { params, col }) => `${col('review_status')} IN (${params.list(v)})`,
  }),
  filter({
    name: 'submission_level',
    label: 'Submission level',
    description: 'PG, EP, CP, NOCP, NOCL, FLAG.',
    value: z.enum(['PG', 'EP', 'CP', 'NOCP', 'NOCL', 'FLAG']),
    sql: (v, { params, col }) => `${col('submission_level')} IN (${params.list(v)})`,
  }),
  filter({
    name: 'method',
    label: 'Collection method',
    description: "ClinVar's collection method, e.g. 'clinical testing', 'research', 'curation'.",
    value: text,
    text: true,
    sql: (v, { params, col }) => `list_has_any(${col('collection_methods')}, [${params.list(v)}])`,
  }),
  filter({
    name: 'condition',
    label: 'Condition',
    description: 'ClinVar condition (trait) ID; condition sets are expanded.',
    value: id,
    sql: (v, { params, col }) =>
      `${col('scv_id')} IN (SELECT scv_id FROM scv_condition WHERE condition_id IN (${params.list(v)}))`,
  }),
  filter({
    name: 'evaluated_after',
    label: 'Evaluated on or after',
    description: 'Date last evaluated, on or after (YYYY-MM-DD).',
    value: date,
    single: true,
    sql: ([v], { params, col }) =>
      `${col('date_last_evaluated')} >= ${params.add(v ?? null)}::DATE`,
  }),
  filter({
    name: 'evaluated_before',
    label: 'Evaluated before',
    description: 'Date last evaluated, before (YYYY-MM-DD).',
    value: date,
    single: true,
    sql: ([v], { params, col }) => `${col('date_last_evaluated')} < ${params.add(v ?? null)}::DATE`,
  }),
  filter({
    name: 'submitted_after',
    label: 'Submitted on or after',
    description: 'Date last submitted, on or after (YYYY-MM-DD).',
    value: date,
    single: true,
    sql: ([v], { params, col }) => `${col('date_submitted')} >= ${params.add(v ?? null)}::DATE`,
  }),
  filter({
    name: 'submitted_before',
    label: 'Submitted before',
    description: 'Date last submitted, before (YYYY-MM-DD).',
    value: date,
    single: true,
    sql: ([v], { params, col }) => `${col('date_submitted')} < ${params.add(v ?? null)}::DATE`,
  }),
  filter({
    name: 'has_comment',
    label: 'Has a comment',
    description: 'Whether the submitter left a comment.',
    value: yesNo,
    single: true,
    sql: ([v], { col }) =>
      v === true ? `${col('description')} IS NOT NULL` : `${col('description')} IS NULL`,
  }),
  filter({
    name: 'comment',
    label: 'Comment contains',
    description: 'Text in the submitter comment, case-insensitive. Slow (about 1 s).',
    value: text,
    text: true,
    sql: (v, { params, col }) =>
      v.map((text) => `${col('description')} ILIKE '%' || ${params.add(text)} || '%'`).join(' OR '),
  }),
];

export const FILTERS_BY_NAME = new Map(FILTERS.map((f) => [f.name, f]));
