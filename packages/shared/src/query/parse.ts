// URL query parameters -> a parsed query (docs/api.md#filters). The server parses every list and
// summary request with this; the web app builds its URLs from the same registries, so a page's
// address and its API request agree.

import { z } from 'zod';
import { DIMENSIONS_BY_NAME, MEASURE_NAMES, type Dimension, type Measure } from './dimensions.ts';
import {
  FILTERS_BY_NAME,
  GeneRelationship,
  type AppliedFilter,
  type FilterContext,
} from './filters.ts';
import type { SqlParams } from './sql.ts';

export type RawQuery = Record<string, string | string[] | undefined>;

export interface ParsedQuery {
  release: string | undefined;
  filters: AppliedFilter[];
  geneRelationship: GeneRelationship;
  groupBy: Dimension[];
  measures: Measure[];
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

/** Parameters that aren't filters. */
const CONTROL = new Set([
  'release',
  'group_by',
  'measure',
  'sort',
  'limit',
  'offset',
  'count',
  'gene_relationship',
  'format',
]);

const Limit = z.coerce.number().int().min(1).max(MAX_LIMIT);
const Offset = z.coerce.number().int().min(0);

function values(raw: string | string[] | undefined): string[] {
  if (raw === undefined) return [];
  return (Array.isArray(raw) ? raw : [raw]).flatMap((v) => v.split(',')).filter((v) => v !== '');
}

export function parseQuery(
  raw: RawQuery,
): { ok: true; query: ParsedQuery } | { ok: false; problems: QueryProblem[] } {
  const problems: QueryProblem[] = [];
  const canonical: Record<string, string[]> = {};
  const filters: AppliedFilter[] = [];

  for (const [key, value] of Object.entries(raw)) {
    if (CONTROL.has(key) || value === undefined) continue;
    const negate = key.startsWith('not.');
    const name = negate ? key.slice(4) : key;
    const filter = FILTERS_BY_NAME.get(name);
    if (filter === undefined) {
      problems.push({ path: `querystring/${key}`, message: `Unknown filter '${name}'.` });
      continue;
    }
    const applied = filter.parse(values(value), negate);
    if ('error' in applied) {
      problems.push({ path: `querystring/${key}`, message: applied.error });
      continue;
    }
    filters.push(applied);
    canonical[key] = applied.values;
  }
  // Pathogenicity unless asked otherwise (classification_type=any for every type).
  if (!filters.some((f) => f.name === 'classification_type')) {
    const applied = FILTERS_BY_NAME.get('classification_type')?.parse(['PATH'], false);
    if (applied !== undefined && !('error' in applied)) {
      filters.push(applied);
      canonical['classification_type'] = applied.values;
    }
  }

  const geneRelationship = GeneRelationship.safeParse(
    values(raw['gene_relationship'])[0] ?? 'within',
  );
  if (!geneRelationship.success) {
    problems.push({ path: 'querystring/gene_relationship', message: 'Use within, single or any.' });
  } else if (filters.some((f) => f.name === 'gene') || values(raw['group_by']).includes('gene')) {
    canonical['gene_relationship'] = [geneRelationship.data];
  }

  const groupBy: Dimension[] = [];
  for (const name of values(raw['group_by'])) {
    const dimension = DIMENSIONS_BY_NAME.get(name);
    if (dimension === undefined) {
      problems.push({ path: 'querystring/group_by', message: `Unknown dimension '${name}'.` });
    } else {
      groupBy.push(dimension);
    }
  }
  if (groupBy.length > 2) {
    problems.push({ path: 'querystring/group_by', message: 'Group by at most two dimensions.' });
  }
  if (groupBy.length > 0) canonical['group_by'] = groupBy.map((d) => d.name);

  const measures: Measure[] = [];
  for (const name of values(raw['measure'])) {
    const measure = MEASURE_NAMES.find((m) => m === name);
    if (measure === undefined) {
      problems.push({ path: 'querystring/measure', message: `Unknown measure '${name}'.` });
    } else {
      measures.push(measure);
    }
  }
  if (measures.length === 0) measures.push('scvs');

  const limit = Limit.safeParse(values(raw['limit'])[0] ?? DEFAULT_LIMIT);
  if (!limit.success) {
    problems.push({ path: 'querystring/limit', message: `limit is 1 to ${String(MAX_LIMIT)}.` });
  }
  const offset = Offset.safeParse(values(raw['offset'])[0] ?? 0);
  if (!offset.success) {
    problems.push({ path: 'querystring/offset', message: 'offset is 0 or more.' });
  }
  const release = values(raw['release'])[0];
  const releaseOk = release === undefined || z.iso.date().safeParse(release).success;
  if (!releaseOk) problems.push({ path: 'querystring/release', message: 'Use YYYY-MM-DD.' });

  if (problems.length > 0 || !limit.success || !offset.success || !geneRelationship.success) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    query: {
      release,
      filters,
      geneRelationship: geneRelationship.data,
      groupBy,
      measures,
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

/** The WHERE clause for a parsed query's filters, over `scv s`. */
export function whereSql(query: ParsedQuery, params: SqlParams): string {
  const ctx: FilterContext = { params, options: { geneRelationship: query.geneRelationship } };
  const predicates = query.filters.map((f) => f.predicate(ctx));
  return predicates.length === 0 ? 'true' : predicates.join(' AND ');
}

/**
 * The query string a list or summary endpoint documents in OpenAPI: every filter (with its
 * `not.` form accepted too) and the control parameters. Validation is parseQuery's.
 */
export function documentedQuery(kind: 'list' | 'summary') {
  const multi = z.union([z.string(), z.array(z.string())]).optional();
  const shape: Record<string, z.ZodType> = {
    release: z
      .string()
      .optional()
      .describe('ClinVar release (YYYY-MM-DD); default the current one.'),
    gene_relationship: z
      .string()
      .optional()
      .describe('How variants belong to a gene: within (default), single, any.'),
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
    shape['group_by'] = multi.describe('One or two dimensions.');
    shape['measure'] = multi.describe('scvs (default), variants, submitters.');
  }
  for (const f of FILTERS_BY_NAME.values()) {
    shape[f.name] = multi.describe(`${f.description} Prefix with not. to exclude.`);
  }
  return z.object(shape).catchall(multi);
}
