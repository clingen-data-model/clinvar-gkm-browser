// The three resources lists and summaries run over (docs/api.md#three-resources-one-query-model):
// SCVs, SCV pairs and variants. Each is a base CTE whose rows (`s`) its dimensions and measures
// read; all three share the filter registry and the compiler in summary.ts.

import {
  CONFLICT_LEVELS,
  CONFLICT_STATUSES,
  PAIR_SIDE_COLUMNS,
  pairCtes,
  pairLevelWhere,
  STATUS_CTE,
  statusWhere,
  type PairOptions,
} from './conflicts.ts';
import { bindDimension, DIMENSION_DEFS, type Col, type Dimension } from './dimensions.ts';
import type { AppliedFilter, FilterOptions } from './filters.ts';
import type { SqlParams } from './sql.ts';
import { filterWhere } from './where.ts';

export type ResourceName = 'scvs' | 'pairs' | 'variants';

/** What a resource's base needs from a parsed query. */
export interface BaseInput {
  filters: readonly AppliedFilter[];
  filterOptions: FilterOptions;
  pair: PairOptions;
}

export interface Resource {
  name: ResourceName;
  /** Whether a./b. side filters and pair options apply. */
  sides: boolean;
  dimensions: ReadonlyMap<string, Dimension>;
  /** Measure name -> aggregate over `s`. */
  measures: Readonly<Record<string, string>>;
  defaultMeasure: string;
  /** CTEs ending in one named `base`. */
  base: (input: BaseInput, params: SqlParams) => string;
}

const scvCol: Col = (name) => `s.${name}`;

/** SCV columns the SCV base keeps, for dimensions and measures. */
const SCV_BASE_COLUMNS = `s.scv_id, s.variation_id, s.submitter_id, s.classification_type, s.term,
  s.review_status, s.submission_level, s.collection_methods, s.date_last_evaluated, s.date_submitted`;

const SIDED = new Set<string>(PAIR_SIDE_COLUMNS);
const sideCol =
  (side: 'a' | 'b'): Col =>
  (name) =>
    SIDED.has(name) ? `s.${side}_${name}` : `s.${name}`;

function byName(dimensions: Dimension[]): ReadonlyMap<string, Dimension> {
  return new Map(dimensions.map((d) => [d.name, d]));
}

const levelLabels = Object.fromEntries(CONFLICT_LEVELS.map((l) => [String(l.level), l.label]));
const statusLabels = Object.fromEntries(CONFLICT_STATUSES.map((s) => [s.status, s.label]));

function levelDimension(column: string, labels: Record<string, string>): Dimension {
  return {
    name: 'conflict_level',
    label: 'Conflict level',
    join: () => '',
    key: () => `s.${column}::VARCHAR`,
    labels: null,
    fixedLabels: labels,
  };
}

function sideWheres(input: BaseInput, params: SqlParams) {
  return {
    a: filterWhere(input.filters, input.filterOptions, params, 'a'),
    b: filterWhere(input.filters, input.filterOptions, params, 'b'),
  };
}

const shared = DIMENSION_DEFS.filter((d) => !d.perScv);
const perScv = DIMENSION_DEFS.filter((d) => d.perScv);

export const SCV_RESOURCE: Resource = {
  name: 'scvs',
  sides: false,
  dimensions: byName(DIMENSION_DEFS.map((d) => bindDimension(d, scvCol))),
  measures: {
    scvs: 'count(DISTINCT s.scv_id)::INTEGER',
    variants: 'count(DISTINCT s.variation_id)::INTEGER',
    submitters: 'count(DISTINCT s.submitter_id)::INTEGER',
  },
  defaultMeasure: 'scvs',
  base: (input, params) =>
    `base AS (SELECT ${SCV_BASE_COLUMNS} FROM scv s WHERE ${filterWhere(input.filters, input.filterOptions, params)})`,
};

export const PAIR_RESOURCE: Resource = {
  name: 'pairs',
  sides: true,
  dimensions: byName([
    ...shared.map((d) => bindDimension(d, scvCol)),
    ...perScv.flatMap((d) => [
      bindDimension(d, sideCol('a'), `a.${d.name}`, `${d.label} (A)`),
      bindDimension(d, sideCol('b'), `b.${d.name}`, `${d.label} (B)`),
    ]),
    levelDimension('level', levelLabels),
  ]),
  measures: {
    pairs: 'count(*)::INTEGER',
    variants: 'count(DISTINCT s.variation_id)::INTEGER',
  },
  defaultMeasure: 'pairs',
  base: (input, params) => {
    const where = sideWheres(input, params);
    return `${pairCtes(where.a, where.b, input.pair)},
      base AS (SELECT * FROM pairs WHERE ${pairLevelWhere(input.pair, params)})`;
  },
};

export const VARIANT_RESOURCE: Resource = {
  name: 'variants',
  sides: true,
  dimensions: byName([
    ...shared.map((d) => bindDimension(d, scvCol)),
    levelDimension('conflict_level', statusLabels),
  ]),
  measures: {
    variants: 'count(DISTINCT s.variation_id)::INTEGER',
  },
  defaultMeasure: 'variants',
  base: (input, params) => {
    const where = sideWheres(input, params);
    return `members AS (SELECT DISTINCT s.variation_id, s.classification_type FROM scv s WHERE ${where.a}),
      ${pairCtes(where.a, where.b, input.pair)},
      ${STATUS_CTE},
      base AS (SELECT * FROM statuses WHERE ${statusWhere(input.pair, params)})`;
  },
};

export const RESOURCES: Readonly<Record<ResourceName, Resource>> = {
  scvs: SCV_RESOURCE,
  pairs: PAIR_RESOURCE,
  variants: VARIANT_RESOURCE,
};
