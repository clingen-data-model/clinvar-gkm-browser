// URL query parameters -> a parsed query (docs/api.md#filters). The server parses every list and
// summary request with this; the web app builds its URLs from the same registries, so a page's
// address and its API request agree.

import { z } from 'zod';
import { ConditionMatch, type PairOptions } from './conflicts.ts';
import type { Dimension } from './dimensions.ts';
import {
  DEFAULT_GENE_RELATIONSHIPS,
  FILTERS_BY_NAME,
  GeneRelationship,
  type AppliedFilter,
  type Side,
} from './filters.ts';
import { RESOURCES, type Resource, type ResourceName } from './resources.ts';
import type { SqlParams } from './sql.ts';
import { filterWhere } from './where.ts';

export type RawQuery = Record<string, string | string[] | undefined>;

export interface ParsedQuery {
  resource: Resource;
  release: string | undefined;
  filters: AppliedFilter[];
  geneRelationships: GeneRelationship[];
  pair: PairOptions;
  groupBy: Dimension[];
  measures: string[];
  /** Text the first dimension's labels must contain (summaries). */
  match: string | null;
  sort: string[];
  limit: number;
  offset: number;
  count: boolean;
  /** The query in canonical form: defaults filled in, keys sorted. Echoed in responses. */
  canonical: Record<string, string[]>;
}

export interface QueryProblem {
  path: string;
  message: string;
}

export const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 50;

/** Pair options, valid on pair and variant resources only. */
const PAIR_PARAMS = new Set([
  'condition_match',
  'flagged',
  'distinct_submitters',
  'min_conflict_level',
  'conflict_level',
]);

/** Parameters that aren't filters. */
const CONTROL = new Set([
  'release',
  'group_by',
  'measure',
  'match',
  'sort',
  'limit',
  'offset',
  'count',
  'gene_relationship',
  'format',
  ...PAIR_PARAMS,
]);

const Limit = z.coerce.number().int().min(1).max(MAX_LIMIT);
const Offset = z.coerce.number().int().min(0);
const PairLevel = z.enum(['0', '1', '2', '3', '4', '5']);
const VariantStatus = z.enum(['single', 'none', 'na', '1', '2', '3', '4', '5']);

function values(raw: string | string[] | undefined): string[] {
  if (raw === undefined) return [];
  return (Array.isArray(raw) ? raw : [raw]).flatMap((v) => v.split(',')).filter((v) => v !== '');
}

/** A filter key's parts: `not.a.submitter` -> negated, side a, filter submitter. */
function filterKey(key: string): { negate: boolean; side: Side; name: string } {
  const negate = key.startsWith('not.');
  const rest = negate ? key.slice(4) : key;
  const side: Side = rest.startsWith('a.') ? 'a' : rest.startsWith('b.') ? 'b' : 'both';
  return { negate, side, name: side === 'both' ? rest : rest.slice(2) };
}

export function parseQuery(
  raw: RawQuery,
  resourceName: ResourceName = 'scvs',
): { ok: true; query: ParsedQuery } | { ok: false; problems: QueryProblem[] } {
  const resource = RESOURCES[resourceName];
  const problems: QueryProblem[] = [];
  const canonical: Record<string, string[]> = {};
  const filters: AppliedFilter[] = [];
  const problem = (key: string, message: string) => {
    problems.push({ path: `querystring/${key}`, message });
  };

  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (CONTROL.has(key)) {
      if (PAIR_PARAMS.has(key) && !resource.sides) {
        problem(key, `${key} applies to pairs and variants, not ${resource.name}.`);
      }
      continue;
    }
    const { negate, side, name } = filterKey(key);
    const filter = FILTERS_BY_NAME.get(name);
    if (filter === undefined) {
      problem(key, `Unknown filter '${name}'.`);
      continue;
    }
    if (side !== 'both' && !resource.sides) {
      problem(key, `Side filters (a., b.) apply to pairs and variants, not ${resource.name}.`);
      continue;
    }
    const applied = filter.parse(values(value), negate, side);
    if ('error' in applied) {
      problem(key, applied.error);
      continue;
    }
    filters.push(applied);
    canonical[key] = applied.values;
  }
  // Pathogenicity unless asked otherwise (classification_type=any for every type).
  if (!filters.some((f) => f.name === 'classification_type' && f.side === 'both')) {
    const applied = FILTERS_BY_NAME.get('classification_type')?.parse(['PATH'], false);
    if (applied !== undefined && !('error' in applied)) {
      filters.push(applied);
      canonical['classification_type'] = applied.values;
    }
  }

  const geneRelationships = parseGeneRelationships(raw['gene_relationship']);
  if (!geneRelationships.ok) {
    problem('gene_relationship', geneRelationships.error);
  } else if (filters.some((f) => f.name === 'gene') || values(raw['group_by']).includes('gene')) {
    canonical['gene_relationship'] = geneRelationships.value;
  }

  const pair = parsePairOptions(raw, resource, filters, problem, canonical);

  const groupBy: Dimension[] = [];
  for (const name of values(raw['group_by'])) {
    const dimension = resource.dimensions.get(name);
    if (dimension === undefined) {
      problem('group_by', `Unknown dimension '${name}' for ${resource.name}.`);
    } else {
      groupBy.push(dimension);
    }
  }
  if (groupBy.length > 2) problem('group_by', 'Group by at most two dimensions.');
  if (groupBy.length > 0) canonical['group_by'] = groupBy.map((d) => d.name);

  const measures: string[] = [];
  for (const name of values(raw['measure'])) {
    if (name in resource.measures) measures.push(name);
    else problem('measure', `Unknown measure '${name}' for ${resource.name}.`);
  }
  if (measures.length === 0) measures.push(resource.defaultMeasure);

  const matchText = values(raw['match'])[0]?.trim() ?? '';
  const match = matchText === '' ? null : matchText;
  if (match !== null) {
    if (groupBy.length === 0) problem('match', 'match filters the first group_by dimension.');
    canonical['match'] = [match];
  }

  const limit = Limit.safeParse(values(raw['limit'])[0] ?? DEFAULT_LIMIT);
  if (!limit.success) problem('limit', `limit is 1 to ${String(MAX_LIMIT)}.`);
  const offset = Offset.safeParse(values(raw['offset'])[0] ?? 0);
  if (!offset.success) problem('offset', 'offset is 0 or more.');
  const release = values(raw['release'])[0];
  if (release !== undefined && !z.iso.date().safeParse(release).success) {
    problem('release', 'Use YYYY-MM-DD.');
  }

  if (problems.length > 0 || !limit.success || !offset.success || !geneRelationships.ok) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    query: {
      resource,
      release,
      filters,
      geneRelationships: geneRelationships.value,
      pair,
      groupBy,
      measures,
      match,
      sort: values(raw['sort']),
      limit: limit.data,
      offset: offset.data,
      count: values(raw['count'])[0] === 'true',
      canonical: Object.fromEntries(
        Object.entries(canonical).sort(([a], [b]) => a.localeCompare(b)),
      ),
    },
  };
}

function parsePairOptions(
  raw: RawQuery,
  resource: Resource,
  filters: AppliedFilter[],
  problem: (key: string, message: string) => void,
  canonical: Record<string, string[]>,
): PairOptions {
  const one = (key: string) => values(raw[key])[0];
  const conditionMatch = ConditionMatch.safeParse(one('condition_match') ?? 'strict');
  if (!conditionMatch.success) problem('condition_match', 'Use strict, wildcard or any.');
  const flagged = one('flagged') ?? 'exclude';
  if (flagged !== 'exclude' && flagged !== 'include') problem('flagged', 'Use exclude or include.');
  const distinct = one('distinct_submitters') ?? 'true';
  if (distinct !== 'true' && distinct !== 'false') {
    problem('distinct_submitters', 'Use true or false.');
  }
  const minRaw = one('min_conflict_level');
  const min = minRaw === undefined ? null : PairLevel.safeParse(minRaw);
  if (min?.success === false) problem('min_conflict_level', 'Use 0 to 5.');
  const levelSchema = resource.name === 'variants' ? VariantStatus : PairLevel;
  const levels = values(raw['conflict_level']);
  const badLevels = levels.filter((l) => !levelSchema.safeParse(l).success);
  if (badLevels.length > 0) {
    problem(
      'conflict_level',
      `Use ${levelSchema.options.join(', ')}; not ${badLevels.join(', ')}.`,
    );
  }

  // Directed when the two sides are filtered differently; then A and B are distinct roles.
  const sideKey = (side: Side) =>
    filters
      .filter((f) => f.side === side)
      .map((f) => `${f.negate ? 'not.' : ''}${f.name}=${f.values.join(',')}`)
      .sort()
      .join('&');
  const directed = sideKey('a') !== sideKey('b');

  if (resource.sides) {
    canonical['condition_match'] = [conditionMatch.success ? conditionMatch.data : 'strict'];
    canonical['flagged'] = [flagged];
    if (distinct === 'false') canonical['distinct_submitters'] = ['false'];
    if (minRaw !== undefined) canonical['min_conflict_level'] = [minRaw];
    if (levels.length > 0) canonical['conflict_level'] = levels;
  }
  return {
    conditionMatch: conditionMatch.success ? conditionMatch.data : 'strict',
    excludeFlagged: flagged !== 'include',
    distinctSubmitters: distinct !== 'false',
    minLevel: min?.success === true ? Number(min.data) : null,
    levels: levels.length > 0 ? levels : null,
    directed,
  };
}

/** gene_relationship's values, in canonical order, or the default if absent. */
export function parseGeneRelationships(
  raw: string | string[] | undefined,
): { ok: true; value: GeneRelationship[] } | { ok: false; error: string } {
  const given = values(raw);
  if (given.length === 0) return { ok: true, value: [...DEFAULT_GENE_RELATIONSHIPS] };
  const bad = given.filter((v) => !GeneRelationship.safeParse(v).success);
  if (bad.length > 0) {
    return {
      ok: false,
      error: `Use ${GeneRelationship.options.join(', ')}; not ${bad.join(', ')}.`,
    };
  }
  return { ok: true, value: GeneRelationship.options.filter((r) => given.includes(r)) };
}

/** The WHERE clause over `scv s` for a parsed query's filters on one side (or all SCVs). */
export function whereSql(query: ParsedQuery, params: SqlParams, side: Side = 'both'): string {
  return filterWhere(query.filters, { geneRelationships: query.geneRelationships }, params, side);
}

/**
 * The query string a list or summary endpoint documents in OpenAPI: every filter (with its
 * `not.`, and on pairs and variants `a.`/`b.`, forms accepted too) and the control parameters.
 * Validation is parseQuery's.
 */
export function documentedQuery(kind: 'list' | 'summary', resourceName: ResourceName = 'scvs') {
  const resource = RESOURCES[resourceName];
  const multi = z.union([z.string(), z.array(z.string())]).optional();
  const shape: Record<string, z.ZodType> = {
    release: z
      .string()
      .optional()
      .describe('ClinVar release (YYYY-MM-DD); default the current one.'),
    gene_relationship: multi.describe(
      `How variants relate to a gene, any of: ${GeneRelationship.options.join(', ')}. Default ${DEFAULT_GENE_RELATIONSHIPS.join(',')}.`,
    ),
    limit: z
      .string()
      .optional()
      .describe(`Rows per page, 1 to ${String(MAX_LIMIT)} (default 50).`),
    offset: z.string().optional().describe('Rows to skip.'),
  };
  if (kind === 'list') {
    shape['sort'] = multi.describe('Sort keys; a leading - sorts descending.');
    shape['count'] = z.string().optional().describe('true to include the total row count.');
  } else {
    shape['group_by'] = multi.describe(
      `One or two of: ${[...resource.dimensions.keys()].join(', ')}.`,
    );
    shape['measure'] = multi.describe(
      `Any of: ${Object.keys(resource.measures).join(', ')} (default ${resource.defaultMeasure}).`,
    );
    shape['match'] = z
      .string()
      .optional()
      .describe("Text the first dimension's labels must contain.");
  }
  if (resource.sides) {
    shape['condition_match'] = z
      .string()
      .optional()
      .describe('strict (default), wildcard (not provided/not specified match any), any.');
    shape['flagged'] = z
      .string()
      .optional()
      .describe('exclude (default) or include flagged SCVs in pairs.');
    shape['distinct_submitters'] = z
      .string()
      .optional()
      .describe('true (default); false to compare a submitter with itself.');
    shape['min_conflict_level'] = z.string().optional().describe('Minimum conflict level, 0 to 5.');
    shape['conflict_level'] = multi.describe(
      resource.name === 'variants'
        ? 'Variant statuses: single, none, na, 1 to 5.'
        : 'Pair conflict levels, 0 to 5.',
    );
  }
  for (const f of FILTERS_BY_NAME.values()) {
    const sides = resource.sides ? ' Prefix with a. or b. for one side of a comparison.' : '';
    shape[f.name] = multi.describe(`${f.description} Prefix with not. to exclude.${sides}`);
  }
  return z.object(shape).catchall(multi);
}
