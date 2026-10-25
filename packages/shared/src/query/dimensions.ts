// Dimensions for summaries (docs/api.md#summaries): what rows can be grouped by. Each is a key
// expression over a resource's rows (`base s`), the joins it needs, and how to label its keys.
// Definitions read their columns through an accessor, so one definition serves an SCV, either
// side of a pair, or a variant (resources.ts binds them). Keys are always strings in responses.
// Some dimensions are multi-valued (an SCV has several conditions, methods or genes) and count a
// row once under each value.

import { clinvarRelationshipTypes, type FilterContext } from './filters.ts';

/** A column of the row a dimension reads: `col('submitter_id')` -> `s.a_submitter_id`. */
export type Col = (name: string) => string;

/** A dimension bound to a resource's columns. */
export interface Dimension {
  name: string;
  label: string;
  /** Joins after `FROM base s`; each must only add rows for multi-valued dimensions. */
  join: (alias: string, ctx: FilterContext) => string;
  key: (alias: string) => string;
  /** A query returning (key, label) for the given placeholder list, or null if keys label themselves. */
  labels: ((placeholders: string) => string) | null;
  /** Fixed labels, for small closed sets. */
  fixedLabels?: Record<string, string>;
}

export interface DimensionDef {
  name: string;
  label: string;
  /** Whether the dimension describes one SCV, and so has a.* and b.* forms on pairs. */
  perScv: boolean;
  join: (alias: string, ctx: FilterContext, col: Col) => string;
  key: (alias: string, col: Col) => string;
  labels: ((placeholders: string) => string) | null;
  fixedLabels?: Record<string, string>;
}

export function bindDimension(
  def: DimensionDef,
  col: Col,
  name = def.name,
  label = def.label,
): Dimension {
  return {
    name,
    label,
    join: (alias, ctx) => def.join(alias, ctx, col),
    key: (alias) => def.key(alias, col),
    labels: def.labels,
    ...(def.fixedLabels === undefined ? {} : { fixedLabels: def.fixedLabels }),
  };
}

export const BUCKET_LABELS: Record<string, string> = {
  P: 'Pathogenic/Likely pathogenic',
  V: 'Uncertain significance',
  B: 'Benign/Likely benign',
  O: 'Other',
  N: 'Not provided',
};

const none = () => '';

export const DIMENSION_DEFS: readonly DimensionDef[] = [
  {
    name: 'submitter',
    label: 'Submitter',
    perScv: true,
    join: none,
    key: (_a, col) => `${col('submitter_id')}::VARCHAR`,
    labels: (p) =>
      `SELECT submitter_id::VARCHAR AS key, name AS label FROM submitter WHERE submitter_id::VARCHAR IN (${p})`,
  },
  {
    name: 'gene',
    label: 'Gene',
    perScv: false,
    join: (a, { params, options }, col) => {
      const types = clinvarRelationshipTypes(options.geneRelationships);
      const where = types === null ? '' : ` WHERE relationship_type IN (${params.list(types)})`;
      return `LEFT JOIN (SELECT variation_id, gene_id FROM variant_gene${where}) ${a} ON ${a}.variation_id = ${col('variation_id')}`;
    },
    key: (a) => `${a}.gene_id::VARCHAR`,
    labels: (p) =>
      `SELECT gene_id::VARCHAR AS key, symbol AS label FROM gene WHERE gene_id::VARCHAR IN (${p})`,
  },
  {
    name: 'condition',
    label: 'Condition',
    perScv: true,
    join: (a, _ctx, col) => `LEFT JOIN scv_condition ${a} ON ${a}.scv_id = ${col('scv_id')}`,
    key: (a) => `${a}.condition_id::VARCHAR`,
    labels: (p) =>
      `SELECT condition_id::VARCHAR AS key, name AS label FROM condition WHERE condition_id::VARCHAR IN (${p})`,
  },
  {
    name: 'classification_type',
    label: 'Classification type',
    perScv: false,
    join: none,
    key: (_a, col) => col('classification_type'),
    labels: (p) => `SELECT code AS key, label FROM classification_type WHERE code IN (${p})`,
  },
  {
    name: 'term',
    label: 'Classification',
    perScv: true,
    join: none,
    key: (_a, col) => `${col('classification_type')} || ':' || coalesce(${col('term')}, '?')`,
    labels: (p) =>
      `SELECT classification_type || ':' || term AS key, label FROM classification_term WHERE classification_type || ':' || term IN (${p})`,
  },
  {
    name: 'bucket',
    label: 'Significance',
    perScv: true,
    join: (a, _ctx, col) =>
      `LEFT JOIN classification_term ${a} ON ${a}.classification_type = ${col('classification_type')} AND ${a}.term = ${col('term')}`,
    key: (a) => `${a}.bucket`,
    labels: null,
    fixedLabels: BUCKET_LABELS,
  },
  {
    name: 'stars',
    label: 'Stars',
    perScv: true,
    join: (a, _ctx, col) => `LEFT JOIN review_status ${a} ON ${a}.status = ${col('review_status')}`,
    key: (a) => `${a}.stars::VARCHAR`,
    labels: null,
  },
  {
    name: 'review_status',
    label: 'Review status',
    perScv: true,
    join: none,
    key: (_a, col) => col('review_status'),
    labels: null,
  },
  {
    name: 'submission_level',
    label: 'Submission level',
    perScv: true,
    join: none,
    key: (_a, col) => col('submission_level'),
    labels: (p) =>
      `SELECT code AS key, quality_name AS label FROM submission_level WHERE code IN (${p})`,
  },
  {
    name: 'method',
    label: 'Collection method',
    perScv: true,
    join: (a, _ctx, col) =>
      `CROSS JOIN LATERAL (SELECT unnest(coalesce(${col('collection_methods')}, [NULL::VARCHAR])) AS method) ${a}`,
    key: (a) => `${a}.method`,
    labels: null,
  },
  {
    name: 'variant_type',
    label: 'Variant type',
    perScv: false,
    join: (a, _ctx, col) => `LEFT JOIN variant ${a} ON ${a}.variation_id = ${col('variation_id')}`,
    key: (a) => `${a}.clinvar_variation_type`,
    labels: null,
  },
  {
    name: 'year_evaluated',
    label: 'Year last evaluated',
    perScv: true,
    join: none,
    key: (_a, col) => `year(${col('date_last_evaluated')})::VARCHAR`,
    labels: null,
  },
  {
    name: 'year_submitted',
    label: 'Year last submitted',
    perScv: true,
    join: none,
    key: (_a, col) => `year(${col('date_submitted')})::VARCHAR`,
    labels: null,
  },
];
