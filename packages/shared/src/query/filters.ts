// The filter registry (docs/api.md#filters). One vocabulary for every list and summary: each
// filter parses its URL values and compiles them to a predicate over `scv s`. Filters on the
// variant (gene, variant type) are semi-joins on s.variation_id, so they work unchanged for the
// SCV and variant resources. A filter is one entry here; routes don't change.
//
// In URLs, a repeated parameter means OR, different parameters mean AND, and a `not.` prefix
// negates the whole filter.

import { z } from 'zod';
import type { SqlParams } from './sql.ts';

/** Options that modify filters rather than filter by themselves. */
export interface FilterOptions {
  geneRelationship: GeneRelationship;
}

export const GeneRelationship = z.enum(['within', 'single', 'any']);
export type GeneRelationship = z.infer<typeof GeneRelationship>;

/** ClinVar gene-list relationships each gene_relationship option includes (docs/api.md, open question 2). */
export const GENE_RELATIONSHIP_TYPES: Record<GeneRelationship, readonly string[] | null> = {
  within: ['within single gene', 'within multiple genes by overlap'],
  single: ['within single gene'],
  any: null,
};

export interface FilterContext {
  params: SqlParams;
  options: FilterOptions;
}

/** A filter with its values parsed: the canonical values for echoing, and its SQL. */
export interface AppliedFilter {
  name: string;
  negate: boolean;
  values: string[];
  predicate: (ctx: FilterContext) => string;
}

export interface Filter {
  name: string;
  label: string;
  description: string;
  /** Parses a filter's raw URL values, or returns the problem with the first bad one. */
  parse: (raw: readonly string[], negate: boolean) => AppliedFilter | { error: string };
}

interface FilterDef<T> {
  name: string;
  label: string;
  description: string;
  value: z.ZodType<T>;
  /** Single-valued filters (dates, minimums) take only one value. */
  single?: boolean;
  sql: (values: T[], ctx: FilterContext) => string;
}

function filter<T>(def: FilterDef<T>): Filter {
  return {
    name: def.name,
    label: def.label,
    description: def.description,
    parse(raw, negate) {
      if (def.single === true && raw.length > 1) return { error: `${def.name} takes one value.` };
      const values: T[] = [];
      for (const r of raw) {
        const parsed = def.value.safeParse(r);
        if (!parsed.success) return { error: `${def.name}: invalid value '${r}'.` };
        values.push(parsed.data);
      }
      return {
        name: def.name,
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
    sql: (v, { params }) => `s.variation_id IN (${params.list(v)})`,
  }),
  filter({
    name: 'gene',
    label: 'Gene',
    description: "NCBI gene ID, through the variant's gene list (see gene_relationship).",
    value: id,
    sql: (v, { params, options }) => {
      const genes = params.list(v);
      const types = GENE_RELATIONSHIP_TYPES[options.geneRelationship];
      const relationship =
        types === null ? '' : ` AND relationship_type IN (${params.list(types)})`;
      return `s.variation_id IN (SELECT variation_id FROM variant_gene WHERE gene_id IN (${genes})${relationship})`;
    },
  }),
  filter({
    name: 'variant_type',
    label: 'Variant type',
    description: "ClinVar's variation type, e.g. 'single nucleotide variant', 'Deletion'.",
    value: text,
    sql: (v, { params }) =>
      `s.variation_id IN (SELECT variation_id FROM variant WHERE clinvar_variation_type IN (${params.list(v)}))`,
  }),
  filter({
    name: 'submitter',
    label: 'Submitter',
    description: 'ClinVar submitter (organization) ID.',
    value: id,
    sql: (v, { params }) => `s.submitter_id IN (${params.list(v)})`,
  }),
  filter({
    name: 'classification_type',
    label: 'Classification type',
    description: "PATH (default), ONCO, SCI, DR, RF, ...; 'any' for all.",
    value: z
      .string()
      .regex(/^[A-Za-z]+$/)
      .transform((v) => v.toUpperCase()),
    sql: (v, { params }) =>
      v.includes('ANY') ? 'true' : `s.classification_type IN (${params.list(v)})`,
  }),
  filter({
    name: 'term',
    label: 'Classification',
    description: 'Normalized term code, e.g. p, lp, vus, lb, b (see /api/v1/vocabularies/terms).',
    value: z.string().regex(/^[a-z0-9/-]+$/),
    sql: (v, { params }) => `s.term IN (${params.list(v)})`,
  }),
  filter({
    name: 'bucket',
    label: 'Significance',
    description: 'P (P/LP), V (uncertain), B (B/LB), O (other), N (not provided).',
    value: z.enum(['P', 'V', 'B', 'O', 'N']),
    sql: (v, { params }) =>
      `(s.classification_type, s.term) IN (SELECT classification_type, term FROM classification_term WHERE bucket IN (${params.list(v)}))`,
  }),
  filter({
    name: 'min_stars',
    label: 'Minimum stars',
    description: 'Minimum review status stars, 0 to 4.',
    value: z.coerce.number().int().min(0).max(4),
    single: true,
    sql: ([v], { params }) =>
      `s.review_status IN (SELECT status FROM review_status WHERE stars >= ${params.add(v ?? 0)})`,
  }),
  filter({
    name: 'stars',
    label: 'Stars',
    description: 'Review status stars, 0 to 4.',
    value: z.coerce.number().int().min(0).max(4),
    sql: (v, { params }) =>
      `s.review_status IN (SELECT status FROM review_status WHERE stars IN (${params.list(v)}))`,
  }),
  filter({
    name: 'review_status',
    label: 'Review status',
    description: "ClinVar's review status text.",
    value: text,
    sql: (v, { params }) => `s.review_status IN (${params.list(v)})`,
  }),
  filter({
    name: 'submission_level',
    label: 'Submission level',
    description: 'PG, EP, CP, NOCP, NOCL, FLAG.',
    value: z.enum(['PG', 'EP', 'CP', 'NOCP', 'NOCL', 'FLAG']),
    sql: (v, { params }) => `s.submission_level IN (${params.list(v)})`,
  }),
  filter({
    name: 'method',
    label: 'Collection method',
    description: "ClinVar's collection method, e.g. 'clinical testing', 'research', 'curation'.",
    value: text,
    sql: (v, { params }) => `list_has_any(s.collection_methods, [${params.list(v)}])`,
  }),
  filter({
    name: 'condition',
    label: 'Condition',
    description: 'ClinVar condition (trait) ID; condition sets are expanded.',
    value: id,
    sql: (v, { params }) =>
      `s.scv_id IN (SELECT scv_id FROM scv_condition WHERE condition_id IN (${params.list(v)}))`,
  }),
  filter({
    name: 'evaluated_after',
    label: 'Evaluated on or after',
    description: 'Date last evaluated, on or after (YYYY-MM-DD).',
    value: date,
    single: true,
    sql: ([v], { params }) => `s.date_last_evaluated >= ${params.add(v ?? null)}::DATE`,
  }),
  filter({
    name: 'evaluated_before',
    label: 'Evaluated before',
    description: 'Date last evaluated, before (YYYY-MM-DD).',
    value: date,
    single: true,
    sql: ([v], { params }) => `s.date_last_evaluated < ${params.add(v ?? null)}::DATE`,
  }),
  filter({
    name: 'submitted_after',
    label: 'Submitted on or after',
    description: 'Date last submitted, on or after (YYYY-MM-DD).',
    value: date,
    single: true,
    sql: ([v], { params }) => `s.date_submitted >= ${params.add(v ?? null)}::DATE`,
  }),
  filter({
    name: 'submitted_before',
    label: 'Submitted before',
    description: 'Date last submitted, before (YYYY-MM-DD).',
    value: date,
    single: true,
    sql: ([v], { params }) => `s.date_submitted < ${params.add(v ?? null)}::DATE`,
  }),
  filter({
    name: 'has_comment',
    label: 'Has a comment',
    description: 'Whether the submitter left a comment.',
    value: yesNo,
    single: true,
    sql: ([v]) => (v === true ? 's.description IS NOT NULL' : 's.description IS NULL'),
  }),
  filter({
    name: 'comment',
    label: 'Comment contains',
    description: 'Text in the submitter comment, case-insensitive. Slow (about 1 s).',
    value: text,
    sql: (v, { params }) =>
      v.map((t) => `s.description ILIKE '%' || ${params.add(t)} || '%'`).join(' OR '),
  }),
];

export const FILTERS_BY_NAME = new Map(FILTERS.map((f) => [f.name, f]));
