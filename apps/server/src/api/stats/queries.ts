// Whole-ClinVar figures (docs/stats.md): counts per release, read from every row a table ever held
// (Database.rowsEver), so a trend needs no table of its own.
//
// Rows are first counted by the span of releases they held in (valid_from, valid_to) and by what
// the figure groups them on, which leaves a few thousand groups; only those are spread over the
// releases counted. Joining every row to every release instead multiplies millions of rows by the
// releases (7.1M SCV rows by 19), and the overview's six figures at once ran a Cloud Run instance
// (4 vCPU, 8 GiB) out of memory. For the same reason the figures' queries run one at a time. A
// figure's result depends only on its options and the releases served, which change only on a
// restart, so results are cached.

import {
  AGGREGATE_CATEGORIES,
  AGREEMENT_GROUPS,
  aggregateCategory,
  CONFLICT_SCV_CATEGORIES,
  CONFLICT_VARIANT_CATEGORIES,
  type PathTerm,
  SCV_SIGNIFICANCE_GROUPS,
  scvSignificanceGroup,
  statsFigure,
  type StatsCategory,
  type StatsOptions,
  type StatsResponse,
  type StatsRow,
  type StatsSlug,
  trendReleases,
  UNMAPPED,
} from '@cvb/shared/api';
import { conditionMatchWhere, SqlParams } from '@cvb/shared/query';
import { z } from 'zod';
import type { Database } from '../../data/database.ts';

const CountRow = z.object({
  release: z.iso.date(),
  label: z.string().nullable(),
  count: z.coerce.number().int(),
});

/** Rows of `t` (with valid_from and valid_to) held in the release `release` (SQL). */
function held(t: string, release: string): string {
  return `${t}.valid_from <= ${release} AND (${t}.valid_to IS NULL OR ${t}.valid_to > ${release})`;
}

/** Where the release spans of rows `a` and `b` overlap (SQL). */
function overlaps(a: string, b: string): string {
  const end = (t: string) => `coalesce(${t}.valid_to, 'infinity'::DATE)`;
  return `${a}.valid_from < ${end(b)} AND ${b}.valid_from < ${end(a)}`;
}

/** The releases counted, as SQL for a table r(release). */
function releaseTable(params: SqlParams, releases: readonly string[]): string {
  const values = releases.map((r) => `(${params.add(r)})`).join(', ');
  return `SELECT CAST(v AS DATE) AS release FROM (VALUES ${values}) AS x(v)`;
}

/** The release's germline pathogenicity terms, by ClinVar's text (lower-cased) and by code. */
async function pathTerms(db: Database, release: string) {
  const rows = z
    .object({
      term: z.string(),
      sourceCode: z.string(),
      label: z.string(),
      significance: z.coerce.number().int(),
    })
    .array()
    .parse(
      await query(
        db,
        release,
        `SELECT term AS term, source_code AS "sourceCode", label AS label, significance AS significance
         FROM classification_term WHERE classification_type = 'PATH'`,
      ),
    );
  return {
    bySource: new Map<string, PathTerm>(rows.map((t) => [t.sourceCode, t])),
    byCode: new Map<string, PathTerm>(rows.map((t) => [t.term, t])),
  };
}

const CONFLICTING = `'Conflicting %'`;

/**
 * CTEs over each variant's germline aggregate (root) rows: `roots`, each row with its span and
 * classification and, for a conflict, whether a contributing SCV is on the pathogenic side; and
 * `counted`, the variants per release, classification and split. The split comes from the row's
 * conflicting_explanation, ClinVar's list of the contributing SCVs' terms ("Likely
 * pathogenic(1); Uncertain significance(1)"). A conflict without one (two expert panels
 * disagreeing) is marked 'unexplained' and left out of `counted`; unexplainedConflicts splits it.
 */
function classifiedCtes(
  db: Database,
  params: SqlParams,
  releases: readonly string[],
  restrict = '',
) {
  const vcv = db.rowsEver('vcv_statement');
  // An explanation's terms with their counts stripped, each looked up in the terms' map.
  const parts = (test: string) =>
    `list_bool_or(list_transform(string_split(t.conflicting_explanation, '; '),
       lambda p: tm.m[lower(regexp_replace(p, '\\(\\d+\\)$', ''))] ${test}))`;
  return `r AS (${releaseTable(params, releases)}),
    tm AS (
      SELECT map(list(source_code), list(significance)) AS m
      FROM classification_term WHERE classification_type = 'PATH'
    ),
    roots AS (
      SELECT t.variation_id AS variation_id, t.valid_from AS valid_from, t.valid_to AS valid_to,
             t.classification AS classification,
             CASE WHEN t.classification IS NULL OR t.classification NOT LIKE ${CONFLICTING} THEN NULL
                  WHEN t.conflicting_explanation IS NULL THEN 'unexplained'
                  WHEN ${parts('= 2')} THEN 'clinsig'
                  WHEN ${parts('IS NULL')} THEN 'unknown'
                  ELSE 'other' END AS conflict
      FROM ${vcv} t, tm
      WHERE t.node_kind = 'root' AND t.classification_type = 'PATH' ${restrict}
    ),
    counted AS (
      SELECT r.release AS release, g.classification AS classification, g.conflict AS conflict,
             sum(g.n) AS n
      FROM (SELECT valid_from, valid_to, classification, conflict, count(*) AS n FROM roots
            WHERE conflict IS DISTINCT FROM 'unexplained' GROUP BY ALL) g
      JOIN r ON ${held('g', 'r.release')}
      GROUP BY ALL
    )`;
}

/**
 * CTE `agreement` over one release's own views: each variant with a germline aggregate, its
 * aggregate review status and its group (AGREEMENT_GROUPS, the first that applies). Submitters are
 * those of its contributing SCVs, as ClinVar's review status counts them.
 */
function agreementCte(params: SqlParams): string {
  const [panel, discordant, several, single] = AGREEMENT_GROUPS.map((g) => params.add(g.name));
  return `contributing AS (
      SELECT s.variation_id AS variation_id, count(DISTINCT s.submitter_id) AS submitters
      FROM scv s JOIN vcv_statement l
        ON l.variation_id = s.variation_id AND l.submission_level = s.submission_level
      WHERE s.classification_type = 'PATH' AND l.classification_type = 'PATH'
        AND l.node_kind = 'level' AND l.contributes
      GROUP BY s.variation_id
    ),
    agreement AS (
      SELECT r.variation_id AS variation_id, r.review_status AS review_status,
             CASE WHEN r.review_status IN ('reviewed by expert panel', 'practice guideline') THEN ${panel}
                  WHEN r.classification LIKE ${CONFLICTING} THEN ${discordant}
                  WHEN c.submitters > 1 THEN ${several}
                  WHEN c.submitters = 1 THEN ${single}
                  ELSE ${params.add(UNMAPPED.name)} END AS grp
      FROM vcv_statement r LEFT JOIN contributing c ON c.variation_id = r.variation_id
      WHERE r.node_kind = 'root' AND r.classification_type = 'PATH'
    )`;
}

interface Unexplained {
  release: string;
  classification: string;
  conflict: 'clinsig' | 'other' | 'unknown';
  /** Its contributing SCVs in the release, by term code. */
  terms: string[];
}

/**
 * The conflicts without a conflicting_explanation in each release (two expert panels disagreeing:
 * two variants on 2026-10-18), split by their contributing SCVs in that release. Looked up by
 * variant ID in a query of their own: joined inside a figure's query, DuckDB can't tell they're
 * few and builds its hash tables from every level node and SCV ever (1.1 GB, measured).
 */
async function unexplainedConflicts(
  db: Database,
  release: string,
  releases: readonly string[],
): Promise<Unexplained[]> {
  const vcv = db.rowsEver('vcv_statement');
  const params = new SqlParams();
  const roots = z
    .object({
      release: z.iso.date(),
      variation_id: z.coerce.number().int(),
      classification: z.string(),
    })
    .array()
    .parse(
      await query(
        db,
        release,
        `WITH r AS (${releaseTable(params, releases)})
         SELECT strftime(r.release, '%Y-%m-%d') AS release, t.variation_id AS variation_id,
                t.classification AS classification
         FROM r JOIN ${vcv} t ON ${held('t', 'r.release')}
         WHERE t.node_kind = 'root' AND t.classification_type = 'PATH'
           AND t.classification LIKE ${CONFLICTING} AND t.conflicting_explanation IS NULL`,
        params.values,
      ),
    );
  if (roots.length === 0) return [];
  const ids = [...new Set(roots.map((r) => r.variation_id))];
  const scvParams = new SqlParams();
  const scvs = z
    .object({
      release: z.iso.date(),
      variation_id: z.coerce.number().int(),
      term: z.string().nullable(),
    })
    .array()
    .parse(
      await query(
        db,
        release,
        `WITH r AS (${releaseTable(scvParams, releases)})
         SELECT strftime(r.release, '%Y-%m-%d') AS release, s.variation_id AS variation_id,
                s.term AS term
         FROM r
         JOIN ${vcv} l ON ${held('l', 'r.release')}
         JOIN ${db.rowsEver('scv')} s ON s.variation_id = l.variation_id
           AND s.submission_level = l.submission_level AND ${held('s', 'r.release')}
         WHERE l.variation_id IN (${scvParams.list(ids)}) AND s.variation_id IN (${scvParams.list(ids)})
           AND l.classification_type = 'PATH' AND l.node_kind = 'level' AND l.contributes
           AND s.classification_type = 'PATH'`,
        scvParams.values,
      ),
    );
  const { byCode } = await pathTerms(db, release);
  return roots.map((root) => {
    const terms = scvs
      .filter((s) => s.release === root.release && s.variation_id === root.variation_id)
      .map((s) => s.term ?? '');
    const significance = terms.map((t) => byCode.get(t)?.significance);
    const conflict = significance.includes(2)
      ? 'clinsig'
      : terms.length === 0 || significance.includes(undefined)
        ? 'unknown'
        : 'other';
    return { release: root.release, classification: root.classification, conflict, terms };
  });
}

const ClassifiedRow = CountRow.extend({
  conflict: z.enum(['clinsig', 'other', 'unknown']).nullable(),
});

/** Variants by aggregate category and label, per release. */
async function aggregateRows(
  db: Database,
  release: string,
  releases: readonly string[],
  singleSubmitterOnly = false,
): Promise<StatsRow[]> {
  const params = new SqlParams();
  const agreement = singleSubmitterOnly ? `${agreementCte(params)},` : '';
  const restrict = singleSubmitterOnly
    ? `AND t.variation_id IN (SELECT variation_id FROM agreement WHERE grp = ${params.add(AGREEMENT_GROUPS[3].name)})`
    : '';
  const rows = ClassifiedRow.array().parse(
    await query(
      db,
      release,
      `WITH ${agreement} ${classifiedCtes(db, params, releases, restrict)}
       SELECT strftime(release, '%Y-%m-%d') AS release, classification AS label, conflict AS conflict,
              sum(n) AS count
       FROM counted GROUP BY ALL`,
      params.values,
    ),
  );
  // Single-submitter variants are never conflicts (those are Discordant), so have none.
  const unexplained = singleSubmitterOnly ? [] : await unexplainedConflicts(db, release, releases);
  const { bySource } = await pathTerms(db, release);
  return merge(
    [
      ...rows,
      ...unexplained.map((u) => ({
        release: u.release,
        label: u.classification,
        conflict: u.conflict,
        count: 1,
      })),
    ].map((r) => ({
      release: r.release,
      category: r.label === null ? UNMAPPED.name : aggregateCategory(r.label, r.conflict, bySource),
      label: r.label,
      count: r.count,
    })),
  );
}

/** Variants by agreement group, labelled by aggregate review status, in one release. */
async function agreementRows(db: Database, release: string): Promise<StatsRow[]> {
  const params = new SqlParams();
  const cte = agreementCte(params);
  const rows = CountRow.extend({ category: z.string() })
    .array()
    .parse(
      await query(
        db,
        release,
        `WITH ${cte}
         SELECT ${params.add(release)} AS release, grp AS category, review_status AS label, count(*) AS count
         FROM agreement GROUP BY ALL`,
        params.values,
      ),
    );
  return merge(rows);
}

/** Germline pathogenicity SCVs by significance group, labelled by term, per release. */
async function scvRows(db: Database, release: string, releases: readonly string[]) {
  const params = new SqlParams();
  const rows = CountRow.array().parse(
    await query(
      db,
      release,
      `WITH r AS (${releaseTable(params, releases)}),
       g AS (
         SELECT s.valid_from AS valid_from, s.valid_to AS valid_to, s.term AS term, count(*) AS n
         FROM ${db.rowsEver('scv')} s WHERE s.classification_type = 'PATH' GROUP BY ALL
       )
       SELECT strftime(r.release, '%Y-%m-%d') AS release, g.term AS label, sum(g.n) AS count
       FROM r JOIN g ON ${held('g', 'r.release')}
       GROUP BY ALL`,
      params.values,
    ),
  );
  const { byCode } = await pathTerms(db, release);
  return merge(
    rows.map((r) => {
      const term = r.label === null ? undefined : byCode.get(r.label);
      return {
        release: r.release,
        category: scvSignificanceGroup(term),
        label: term?.label ?? r.label,
        count: r.count,
      };
    }),
  );
}

/** The stored pairs that are clinically significant conflicts under the options (alias p). */
function pairConflictWhere(options: StatsOptions): string {
  const condition = conditionMatchWhere(options.condition_match ?? 'strict', 'p');
  return [
    `p.classification_type = 'PATH'`,
    'p.level = 5',
    `p.a_submission_level <> 'FLAG'`,
    `p.b_submission_level <> 'FLAG'`,
    'p.a_submitter_id <> p.b_submitter_id',
    ...(condition === null ? [] : [condition]),
  ].join(' AND ');
}

/** Variants in a clinically significant conflict and the rest, per release. */
async function conflictVariantRows(
  db: Database,
  release: string,
  releases: readonly string[],
  options: StatsOptions,
): Promise<StatsRow[]> {
  const aggregate = await cached(
    db,
    'aggregate-classification',
    release,
    releases,
    NO_OPTIONS,
    () => aggregateRows(db, release, releases),
  );
  const [yes, no] = CONFLICT_VARIANT_CATEGORIES.map((c) => c.name);
  const totals = sumBy(aggregate, (r) => r.release);
  let conflicted: Map<string, number>;
  let label: string | null;
  if (options.conflict === 'pairs') {
    const params = new SqlParams();
    const rows = CountRow.array().parse(
      await query(
        db,
        release,
        `WITH r AS (${releaseTable(params, releases)}),
         g AS (
           SELECT DISTINCT p.variation_id AS variation_id, p.valid_from AS valid_from,
                  p.valid_to AS valid_to
           FROM ${db.rowsEver('scv_classification_pair')} p WHERE ${pairConflictWhere(options)}
         )
         SELECT strftime(r.release, '%Y-%m-%d') AS release, NULL AS label,
                count(DISTINCT g.variation_id) AS count
         FROM r JOIN g ON ${held('g', 'r.release')}
         GROUP BY ALL`,
        params.values,
      ),
    );
    conflicted = new Map(rows.map((r) => [r.release, r.count]));
    label = 'Level 5 pair';
  } else {
    conflicted = sumBy(
      aggregate.filter((r) => r.category === AGGREGATE_CATEGORIES[3].name),
      (r) => r.release,
    );
    label = 'Conflicting classifications of pathogenicity';
  }
  return releases.flatMap((r) => {
    const n = conflicted.get(r) ?? 0;
    return [
      { release: r, category: yes ?? '', label, count: n },
      { release: r, category: no ?? '', label: null, count: (totals.get(r) ?? 0) - n },
    ];
  });
}

/** SCVs in a clinically significant conflict (labelled by their side) and the rest, per release. */
async function conflictScvRows(
  db: Database,
  release: string,
  releases: readonly string[],
  options: StatsOptions,
): Promise<StatsRow[]> {
  const scvs = await cached(db, 'vus-submissions', release, releases, NO_OPTIONS, () =>
    scvRows(db, release, releases),
  );
  const params = new SqlParams();
  const vcv = db.rowsEver('vcv_statement');
  const scv = db.rowsEver('scv');
  const end = (t: string) => `coalesce(${t}.valid_to, 'infinity'::DATE)`;
  const sql =
    options.conflict === 'pairs'
      ? `WITH r AS (${releaseTable(params, releases)}),
         g AS (
           SELECT DISTINCT p.a_scv_id AS scv_id, p.a_term AS term, p.valid_from AS valid_from,
                  p.valid_to AS valid_to
           FROM ${db.rowsEver('scv_classification_pair')} p WHERE ${pairConflictWhere(options)}
         )
         SELECT strftime(r.release, '%Y-%m-%d') AS release, g.term AS label,
                count(DISTINCT g.scv_id) AS count
         FROM r JOIN g ON ${held('g', 'r.release')}
         GROUP BY ALL`
      : // Each SCV's span within a conflicting root and its contributing level node. A variant
        // has one root and one node per level at a time, so an SCV's spans never overlap and
        // can be counted without DISTINCT. The conflicting levels' spans come first, as a small
        // table, so the SCVs stream past it rather than being held to join.
        `WITH ${classifiedCtes(db, params, releases)},
         levels AS MATERIALIZED (
           SELECT c.variation_id AS variation_id, l.submission_level AS submission_level,
                  greatest(c.valid_from, l.valid_from) AS valid_from,
                  nullif(least(${end('c')}, ${end('l')}), 'infinity'::DATE) AS valid_to
           FROM roots c
           JOIN ${vcv} l ON l.variation_id = c.variation_id AND ${overlaps('l', 'c')}
           WHERE c.conflict = 'clinsig'
             AND l.classification_type = 'PATH' AND l.node_kind = 'level' AND l.contributes
         ),
         spans AS (
           SELECT greatest(c.valid_from, s.valid_from) AS valid_from,
                  nullif(least(${end('c')}, ${end('s')}), 'infinity'::DATE) AS valid_to,
                  s.term AS term
           FROM levels c
           JOIN ${scv} s ON s.variation_id = c.variation_id AND s.submission_level = c.submission_level
             AND ${overlaps('s', 'c')}
           WHERE s.classification_type = 'PATH'
         ),
         g AS (SELECT valid_from, valid_to, term, count(*) AS n FROM spans GROUP BY ALL)
         SELECT strftime(r.release, '%Y-%m-%d') AS release, g.term AS label, sum(g.n) AS count
         FROM r JOIN g ON ${held('g', 'r.release')}
         GROUP BY ALL`;
  const rows = CountRow.array().parse(await query(db, release, sql, params.values));
  if (options.conflict !== 'pairs') {
    for (const u of await unexplainedConflicts(db, release, releases)) {
      if (u.conflict !== 'clinsig') continue;
      for (const term of u.terms) rows.push({ release: u.release, label: term, count: 1 });
    }
  }
  const { byCode } = await pathTerms(db, release);
  const [yes, no] = CONFLICT_SCV_CATEGORIES.map((c) => c.name);
  const inConflict = merge(
    rows.map((r) => ({
      release: r.release,
      category: yes ?? '',
      label: scvSignificanceGroup(r.label === null ? undefined : byCode.get(r.label)),
      count: r.count,
    })),
  );
  const totals = sumBy(scvs, (r) => r.release);
  const conflicted = sumBy(inConflict, (r) => r.release);
  return [
    ...inConflict,
    ...releases.map((r) => ({
      release: r,
      category: no ?? '',
      label: null,
      count: (totals.get(r) ?? 0) - (conflicted.get(r) ?? 0),
    })),
  ];
}

// The figures' queries, one at a time: each reads millions of rows, and several at once on a
// small instance compete for its memory. Each figure's result is cached, so they queue only once.
let running: Promise<unknown> = Promise.resolve();

function query(
  db: Database,
  release: string,
  sql: string,
  params: Parameters<Database['query']>[2] = [],
): ReturnType<Database['query']> {
  const run = running.then(() => db.query(release, sql, params));
  running = run.catch(() => undefined);
  return run;
}

/** Rows with the same release, category and label added together, in a stable order. */
function merge(rows: StatsRow[]): StatsRow[] {
  const merged = new Map<string, StatsRow>();
  for (const row of rows) {
    const key = JSON.stringify([row.release, row.category, row.label]);
    const seen = merged.get(key);
    if (seen === undefined) merged.set(key, { ...row });
    else seen.count += row.count;
  }
  return [...merged.values()].sort(
    (a, b) =>
      a.release.localeCompare(b.release) ||
      a.category.localeCompare(b.category) ||
      b.count - a.count ||
      (a.label ?? '').localeCompare(b.label ?? ''),
  );
}

function sumBy(rows: StatsRow[], key: (r: StatsRow) => string): Map<string, number> {
  const sums = new Map<string, number>();
  for (const r of rows) sums.set(key(r), (sums.get(key(r)) ?? 0) + r.count);
  return sums;
}

/** Categories in display order, with Unmapped added when anything is in it. */
function categoriesOf(listed: readonly StatsCategory[], rows: StatsRow[]): StatsCategory[] {
  const unmapped = rows.some((r) => r.category === UNMAPPED.name && r.count > 0);
  return [...listed.map((c) => ({ name: c.name, rule: c.rule })), ...(unmapped ? [UNMAPPED] : [])];
}

/** The options that change a figure's rows (`every` only picks the releases). */
function rowOptions(options: StatsOptions): Record<string, string | null> {
  return { conflict: options.conflict ?? null, condition_match: options.condition_match ?? null };
}
const NO_OPTIONS = rowOptions({});

// Results by figure, release, releases and options. Bounded, though the options make few keys.
const cache = new Map<string, Promise<StatsRow[]>>();
const CACHE_LIMIT = 500;

function cached(
  db: Database,
  slug: StatsSlug,
  release: string,
  releases: readonly string[],
  options: Record<string, string | null>,
  compute: () => Promise<StatsRow[]>,
): Promise<StatsRow[]> {
  // The database is part of the key: tests open several, over different data.
  const key = JSON.stringify([dbId(db), slug, release, releases, options]);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const promise = compute();
  // A failed query (a timeout) isn't remembered.
  promise.catch(() => cache.delete(key));
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, promise);
  return promise;
}

const dbIds = new WeakMap<Database, number>();
let lastDbId = 0;
function dbId(db: Database): number {
  let id = dbIds.get(db);
  if (id === undefined) {
    id = ++lastDbId;
    dbIds.set(db, id);
  }
  return id;
}

/** A figure's data as of `release`: that release, or a trend's releases up to it. */
export async function statsData(
  db: Database,
  slug: StatsSlug,
  release: string,
  options: StatsOptions,
): Promise<StatsResponse> {
  const figure = statsFigure(slug);
  const served = db.available().releases.map((r) => r.release.clinvarRelease);
  const releases =
    figure.span === 'release'
      ? [release]
      : trendReleases(served, release, options.every ?? 'release');
  const compute = (): Promise<StatsRow[]> => {
    switch (slug) {
      case 'aggregate-classification':
        return aggregateRows(db, release, releases);
      case 'single-submitter-classification':
        return aggregateRows(db, release, releases, true);
      case 'submitter-agreement':
        return agreementRows(db, release);
      case 'vus-submissions':
        return scvRows(db, release, releases);
      case 'clinsig-conflict-variants':
        return conflictVariantRows(db, release, releases, options);
      case 'clinsig-conflict-submissions':
        return conflictScvRows(db, release, releases, options);
    }
  };
  const listed: Record<StatsSlug, readonly StatsCategory[]> = {
    'aggregate-classification': AGGREGATE_CATEGORIES,
    'single-submitter-classification': AGGREGATE_CATEGORIES,
    'submitter-agreement': AGREEMENT_GROUPS,
    'vus-submissions': SCV_SIGNIFICANCE_GROUPS,
    'clinsig-conflict-variants': CONFLICT_VARIANT_CATEGORIES,
    'clinsig-conflict-submissions': CONFLICT_SCV_CATEGORIES,
  };
  const rows = await cached(db, slug, release, releases, rowOptions(options), compute);
  return {
    release,
    figure: slug,
    options: Object.fromEntries(Object.entries(options).map(([k, v]) => [k, String(v)])),
    releases,
    categories: categoriesOf(listed[slug], rows),
    rows,
  };
}

/** A figure's rows as CSV. */
export function statsCsv(data: StatsResponse): string {
  const cell = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const lines = [['release', 'category', 'label', 'count'].join(',')];
  for (const r of data.rows)
    lines.push([r.release, r.category, r.label, r.count].map(cell).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
