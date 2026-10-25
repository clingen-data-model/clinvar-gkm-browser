// Dimensions for summaries (docs/api.md#summaries): what rows can be grouped by. Each is a key
// expression over `s` (the filtered SCVs), the joins it needs, and how to label its keys. Keys
// are always strings in responses. Some dimensions are multi-valued (an SCV has several
// conditions, methods or genes) and count an SCV once under each value.

import { clinvarRelationshipTypes, type FilterContext } from './filters.ts';

export interface Dimension {
  name: string;
  label: string;
  multiValued: boolean;
  /** Joins after `FROM base s`; each must only add rows for multi-valued dimensions. */
  join: (alias: string, ctx: FilterContext) => string;
  key: (alias: string) => string;
  /** A query returning (key, label) for the given placeholder list, or null if keys label themselves. */
  labels: ((placeholders: string) => string) | null;
  /** Fixed labels, for small closed sets. */
  fixedLabels?: Record<string, string>;
}

export const BUCKET_LABELS: Record<string, string> = {
  P: 'Pathogenic/Likely pathogenic',
  V: 'Uncertain significance',
  B: 'Benign/Likely benign',
  O: 'Other',
  N: 'Not provided',
};

export const DIMENSIONS: readonly Dimension[] = [
  {
    name: 'submitter',
    label: 'Submitter',
    multiValued: false,
    join: () => '',
    key: () => 's.submitter_id::VARCHAR',
    labels: (p) =>
      `SELECT submitter_id::VARCHAR AS key, name AS label FROM submitter WHERE submitter_id::VARCHAR IN (${p})`,
  },
  {
    name: 'gene',
    label: 'Gene',
    multiValued: true,
    join: (a, { params, options }) => {
      const types = clinvarRelationshipTypes(options.geneRelationships);
      const where = types === null ? '' : ` WHERE relationship_type IN (${params.list(types)})`;
      return `LEFT JOIN (SELECT variation_id, gene_id FROM variant_gene${where}) ${a} ON ${a}.variation_id = s.variation_id`;
    },
    key: (a) => `${a}.gene_id::VARCHAR`,
    labels: (p) =>
      `SELECT gene_id::VARCHAR AS key, symbol AS label FROM gene WHERE gene_id::VARCHAR IN (${p})`,
  },
  {
    name: 'condition',
    label: 'Condition',
    multiValued: true,
    join: (a) => `LEFT JOIN scv_condition ${a} ON ${a}.scv_id = s.scv_id`,
    key: (a) => `${a}.condition_id::VARCHAR`,
    labels: (p) =>
      `SELECT condition_id::VARCHAR AS key, name AS label FROM condition WHERE condition_id::VARCHAR IN (${p})`,
  },
  {
    name: 'classification_type',
    label: 'Classification type',
    multiValued: false,
    join: () => '',
    key: () => 's.classification_type',
    labels: (p) => `SELECT code AS key, label FROM classification_type WHERE code IN (${p})`,
  },
  {
    name: 'term',
    label: 'Classification',
    multiValued: false,
    join: () => '',
    key: () => `s.classification_type || ':' || coalesce(s.term, '?')`,
    labels: (p) =>
      `SELECT classification_type || ':' || term AS key, label FROM classification_term WHERE classification_type || ':' || term IN (${p})`,
  },
  {
    name: 'bucket',
    label: 'Significance',
    multiValued: false,
    join: (a) =>
      `LEFT JOIN classification_term ${a} ON ${a}.classification_type = s.classification_type AND ${a}.term = s.term`,
    key: (a) => `${a}.bucket`,
    labels: null,
    fixedLabels: BUCKET_LABELS,
  },
  {
    name: 'stars',
    label: 'Stars',
    multiValued: false,
    join: (a) => `LEFT JOIN review_status ${a} ON ${a}.status = s.review_status`,
    key: (a) => `${a}.stars::VARCHAR`,
    labels: null,
  },
  {
    name: 'review_status',
    label: 'Review status',
    multiValued: false,
    join: () => '',
    key: () => 's.review_status',
    labels: null,
  },
  {
    name: 'submission_level',
    label: 'Submission level',
    multiValued: false,
    join: () => '',
    key: () => 's.submission_level',
    labels: (p) =>
      `SELECT code AS key, quality_name AS label FROM submission_level WHERE code IN (${p})`,
  },
  {
    name: 'method',
    label: 'Collection method',
    multiValued: true,
    join: (a) =>
      `CROSS JOIN LATERAL (SELECT unnest(coalesce(s.collection_methods, [NULL::VARCHAR])) AS method) ${a}`,
    key: (a) => `${a}.method`,
    labels: null,
  },
  {
    name: 'variant_type',
    label: 'Variant type',
    multiValued: false,
    join: (a) => `LEFT JOIN variant ${a} ON ${a}.variation_id = s.variation_id`,
    key: (a) => `${a}.clinvar_variation_type`,
    labels: null,
  },
  {
    name: 'year_evaluated',
    label: 'Year last evaluated',
    multiValued: false,
    join: () => '',
    key: () => 'year(s.date_last_evaluated)::VARCHAR',
    labels: null,
  },
  {
    name: 'year_submitted',
    label: 'Year last submitted',
    multiValued: false,
    join: () => '',
    key: () => 'year(s.date_submitted)::VARCHAR',
    labels: null,
  },
];

export const DIMENSIONS_BY_NAME = new Map(DIMENSIONS.map((d) => [d.name, d]));

/** What a summary can count. Distinct counts, so multi-valued dimensions don't double count. */
export const MEASURES = {
  scvs: 'count(DISTINCT s.scv_id)::INTEGER',
  variants: 'count(DISTINCT s.variation_id)::INTEGER',
  submitters: 'count(DISTINCT s.submitter_id)::INTEGER',
} as const;
export type Measure = keyof typeof MEASURES;
export const MEASURE_NAMES = [
  'scvs',
  'variants',
  'submitters',
] as const satisfies readonly Measure[];
