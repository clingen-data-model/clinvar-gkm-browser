// Whole-ClinVar figures (docs/stats.md): the figures, their options, the categories they count in
// and the rules that put a classification in one. Shared so the server's counts and the page's
// "what each category contains" table come from the same rules.

import { z } from 'zod';
import { ConditionMatch } from '../query/conflicts.ts';
import { ReleaseDate } from './release.ts';

/**
 * bq-tools' strength_code and penetrance_level for each germline pathogenicity term
 * (clinvar_clinsig_types at 2ca57d8, docs/stats.md#aggregate-classification-categories). They
 * belong in classification_term and move there at the next rebuild.
 */
export const PATH_TERM_QUALITIES: Readonly<
  Record<
    string,
    { strength: 'definitive' | 'likely' | null; penetrance: 'low' | 'risk allele' | null }
  >
> = {
  p: { strength: 'definitive', penetrance: null },
  lp: { strength: 'likely', penetrance: null },
  'p/lp': { strength: null, penetrance: null },
  'p-lp': { strength: 'definitive', penetrance: 'low' },
  'lp-lp': { strength: 'likely', penetrance: 'low' },
  era: { strength: 'definitive', penetrance: 'risk allele' },
  lra: { strength: 'likely', penetrance: 'risk allele' },
  vus: { strength: null, penetrance: null },
  'vus-h': { strength: null, penetrance: null },
  'vus-m': { strength: null, penetrance: null },
  'vus-l': { strength: null, penetrance: null },
  ura: { strength: null, penetrance: 'risk allele' },
  b: { strength: 'definitive', penetrance: null },
  lb: { strength: 'likely', penetrance: null },
  'b/lb': { strength: null, penetrance: null },
};

/** A germline pathogenicity term, from classification_term. */
export interface PathTerm {
  term: string;
  /** ClinVar's text for it, lower-cased: what labels are matched on. */
  sourceCode: string;
  label: string;
  significance: number;
}

/** A category and the rule that puts things in it. */
export interface StatsCategory {
  name: string;
  rule: string;
}

/** Shown, never dropped, for anything no rule covers (a new term upstream). */
export const UNMAPPED = {
  name: 'Unmapped',
  rule: 'No rule covers it, such as a term this app doesn’t know yet.',
} as const satisfies StatsCategory;

/** The aggregate classification categories, in the order a bar stacks them, top first. */
export const AGGREGATE_CATEGORIES = [
  {
    name: 'Pathogenic',
    rule: 'Pathogenic side (significance 2), no penetrance level, every term definitive.',
  },
  {
    name: 'Likely pathogenic',
    rule: 'Pathogenic side (significance 2), no penetrance level, not every term definitive: Likely pathogenic, and Pathogenic/Likely pathogenic.',
  },
  {
    name: 'Low penetrance / risk allele',
    rule: 'Pathogenic side (significance 2), any term with a penetrance level: low penetrance, established or likely risk allele.',
  },
  {
    name: 'Conflict: P/LP vs VUS/LB/B',
    rule: 'Conflicting, with a contributing SCV on the pathogenic side.',
  },
  {
    name: 'VUS',
    rule: 'Uncertain (significance 1), including VUS-high, -mid and -low, and uncertain risk allele.',
  },
  {
    name: 'Conflict: VUS vs LB/B',
    rule: 'Conflicting, with no contributing SCV on the pathogenic side.',
  },
  {
    name: 'Likely benign',
    rule: 'Benign side (significance 0), not every term definitive: Likely benign, and Benign/Likely benign.',
  },
  { name: 'Benign', rule: 'Benign side (significance 0), every term definitive.' },
  { name: 'No classification', rule: 'All of the variant’s SCVs are flagged.' },
] as const satisfies readonly StatsCategory[];

export type AggregateCategoryName =
  (typeof AGGREGATE_CATEGORIES)[number]['name'] | typeof UNMAPPED.name;

/** How a conflicting aggregate splits: by whether a contributing SCV is on the pathogenic side. */
export type ConflictSplit = 'clinsig' | 'other' | 'unknown';

const NO_CLASSIFICATION_LABEL = 'no classifications from unflagged records';

/** Whether an aggregate classification label is ClinVar's conflict call. */
export function isConflictLabel(label: string): boolean {
  return label.startsWith('Conflicting ');
}

/**
 * The category of a variant's aggregate germline classification. A label is one term, or the
 * contributing SCVs' terms joined with "/" ("Pathogenic/Likely pathogenic, low penetrance").
 */
export function aggregateCategory(
  label: string,
  conflict: ConflictSplit | null,
  terms: ReadonlyMap<string, PathTerm>,
): AggregateCategoryName {
  if (isConflictLabel(label)) {
    if (conflict === 'clinsig') return 'Conflict: P/LP vs VUS/LB/B';
    if (conflict === 'other') return 'Conflict: VUS vs LB/B';
    return 'Unmapped';
  }
  if (label === NO_CLASSIFICATION_LABEL) return 'No classification';
  const whole = terms.get(label.toLowerCase());
  const parts =
    whole === undefined ? label.split('/').map((p) => terms.get(p.toLowerCase())) : [whole];
  if (parts.some((p) => p === undefined)) return 'Unmapped';
  const known = parts.filter((p) => p !== undefined);
  const significance = new Set(known.map((p) => p.significance));
  const qualities = known.map((p) => PATH_TERM_QUALITIES[p.term]);
  if (significance.size !== 1 || qualities.some((q) => q === undefined)) return 'Unmapped';
  const definitive = qualities.every((q) => q?.strength === 'definitive');
  const [only] = significance;
  if (only === 2) {
    if (qualities.some((q) => q?.penetrance != null)) return 'Low penetrance / risk allele';
    return definitive ? 'Pathogenic' : 'Likely pathogenic';
  }
  if (only === 1) return 'VUS';
  if (only === 0) return definitive ? 'Benign' : 'Likely benign';
  return 'Unmapped';
}

/** SCVs by their term's significance, for the VUS trend. */
export const SCV_SIGNIFICANCE_GROUPS = [
  {
    name: 'Pathogenic side',
    rule: 'Significance 2: pathogenic, likely pathogenic, low penetrance, risk alleles.',
  },
  {
    name: 'VUS',
    rule: 'Significance 1: uncertain significance, VUS-high, -mid and -low, uncertain risk allele.',
  },
  { name: 'Benign side', rule: 'Significance 0: benign, likely benign.' },
] as const satisfies readonly StatsCategory[];

export function scvSignificanceGroup(term: PathTerm | undefined): string {
  if (term === undefined) return UNMAPPED.name;
  return { 2: 'Pathogenic side', 1: 'VUS', 0: 'Benign side' }[term.significance] ?? UNMAPPED.name;
}

/** How a variant's germline classification was reached; the first group that applies. */
export const AGREEMENT_GROUPS = [
  {
    name: 'Expert panel or practice guideline',
    rule: 'Its aggregate review status is reviewed by expert panel, or practice guideline.',
  },
  {
    name: 'Discordant',
    rule: 'Its aggregate is conflicting (including a submitter whose own SCVs conflict).',
  },
  {
    name: 'Several concordant submitters',
    rule: 'More than one submitter among its contributing SCVs, which agree.',
  },
  { name: 'Single submitter', rule: 'One submitter among its contributing SCVs.' },
] as const satisfies readonly StatsCategory[];

export const CONFLICT_VARIANT_CATEGORIES = [
  {
    name: 'Clinically significant conflict',
    rule: 'Under the conflict definition chosen.',
  },
  {
    name: 'No clinically significant conflict',
    rule: 'Every other variant with a germline classification.',
  },
] as const satisfies readonly StatsCategory[];

export const CONFLICT_SCV_CATEGORIES = [
  {
    name: 'In a clinically significant conflict',
    rule: 'Under the conflict definition chosen; labelled by the SCV’s own side.',
  },
  { name: 'Not in one', rule: 'Every other germline pathogenicity SCV.' },
] as const satisfies readonly StatsCategory[];

export const CONFLICT_DEFINITIONS = {
  aggregate: {
    label: 'ClinVar’s aggregate',
    rule: 'The variant’s aggregate is conflicting and a contributing SCV is on the pathogenic side: ClinVar’s own call, over the SCVs at the submission level it is computed from.',
  },
  pairs: {
    label: 'Pairs of submissions',
    rule: 'Two SCVs of the variant, from different submitters and neither flagged, are on the pathogenic side and uncertain or benign: ClinVar Miner’s level 5, over every submission level, as on the conflict pages.',
  },
} as const;
export const ConflictDefinition = z.enum(['aggregate', 'pairs']);
export type ConflictDefinition = z.infer<typeof ConflictDefinition>;

export const Every = z.enum(['release', 'month']);
export type Every = z.infer<typeof Every>;

export const EVERY_LABELS: Record<Every, string> = {
  release: 'Every release',
  month: 'The last release of each month',
};

/** A figure's options, each absent when the figure doesn't take it. */
export interface StatsOptions {
  every?: Every;
  conflict?: ConflictDefinition;
  condition_match?: ConditionMatch;
}

export const StatsSlug = z.enum([
  'aggregate-classification',
  'submitter-agreement',
  'single-submitter-classification',
  'vus-submissions',
  'clinsig-conflict-variants',
  'clinsig-conflict-submissions',
]);
export type StatsSlug = z.infer<typeof StatsSlug>;

export interface StatsFigure {
  slug: StatsSlug;
  title: string;
  description: string;
  /** One release, or a trend over the releases up to one. */
  span: 'release' | 'releases';
  unit: 'variants' | 'SCVs';
  /** The options it takes, with their defaults. */
  defaults: StatsOptions;
}

/** The figures, in the order the overview shows them. */
export const STATS_FIGURES: readonly StatsFigure[] = [
  {
    slug: 'aggregate-classification',
    title: 'Aggregate classification of variants',
    description:
      'Every variant’s aggregate germline classification (pathogenicity), as shares of all variants with one.',
    span: 'releases',
    unit: 'variants',
    defaults: { every: 'month' },
  },
  {
    slug: 'submitter-agreement',
    title: 'How variants’ classifications were reached',
    description:
      'Variants with a germline classification by whether an expert panel classified them, their submitters disagree, several agree, or one submitter classified them.',
    span: 'release',
    unit: 'variants',
    defaults: {},
  },
  {
    slug: 'single-submitter-classification',
    title: 'Aggregate classification of single-submitter variants',
    description:
      'The aggregate germline classification of the variants classified by a single submitter.',
    span: 'release',
    unit: 'variants',
    defaults: {},
  },
  {
    slug: 'vus-submissions',
    title: 'VUS submissions',
    description:
      'Germline pathogenicity SCVs classifying a variant as uncertain significance, as a count and as a share of all germline pathogenicity SCVs.',
    span: 'releases',
    unit: 'SCVs',
    defaults: { every: 'release' },
  },
  {
    slug: 'clinsig-conflict-variants',
    title: 'Variants with a clinically significant conflict',
    description:
      'Variants whose germline submissions conflict between pathogenic and uncertain or benign, each counted once.',
    span: 'releases',
    unit: 'variants',
    defaults: { every: 'release', conflict: 'aggregate' },
  },
  {
    slug: 'clinsig-conflict-submissions',
    title: 'Submissions in a clinically significant conflict',
    description:
      'Germline pathogenicity SCVs on either side of a clinically significant conflict, each counted once.',
    span: 'releases',
    unit: 'SCVs',
    defaults: { every: 'release', conflict: 'aggregate' },
  },
];

export function statsFigure(slug: StatsSlug): StatsFigure {
  const figure = STATS_FIGURES.find((f) => f.slug === slug);
  if (figure === undefined) throw new Error(`no figure ${slug}`);
  return figure;
}

/** Options a figure takes beyond its defaults; condition_match only applies to pairs. */
export function takesOption(figure: StatsFigure, option: keyof StatsOptions): boolean {
  if (option === 'condition_match') return figure.defaults.conflict !== undefined;
  return figure.defaults[option] !== undefined;
}

export const StatsQuery = z.object({
  release: ReleaseDate.optional().describe(
    'The release shown, or the last release of a trend; default the latest.',
  ),
  every: Every.optional().describe('A trend’s releases: every release, or the last of each month.'),
  conflict: ConflictDefinition.optional().describe(
    'What counts as a clinically significant conflict: ClinVar’s aggregate (default), or pairs of submissions.',
  ),
  condition_match: ConditionMatch.optional().describe(
    'With conflict=pairs: strict (default, the two SCVs share a condition), wildcard (or either has none), or any.',
  ),
  format: z.enum(['json', 'csv']).optional().describe('json (default) or csv, the rows only.'),
});
export type StatsQuery = z.infer<typeof StatsQuery>;

export const StatsRow = z.object({
  release: ReleaseDate,
  category: z.string(),
  /** What was counted in the category: an aggregate label, an SCV term or a review status. */
  label: z.string().nullable(),
  count: z.int(),
});
export type StatsRow = z.infer<typeof StatsRow>;

export const StatsResponse = z.object({
  /** The release asked for: the one shown, or a trend's last. */
  release: ReleaseDate,
  figure: StatsSlug,
  /** The options applied, defaults included. */
  options: z.record(z.string(), z.string()),
  /** The releases counted, oldest first. */
  releases: z.array(ReleaseDate),
  /** The categories in display order, each with its rule; Unmapped only when something is. */
  categories: z.array(z.object({ name: z.string(), rule: z.string() })),
  /** Counts per release, category and label. A release's rows add up to everything counted. */
  rows: z.array(StatsRow),
});
export type StatsResponse = z.infer<typeof StatsResponse>;

export const StatsFigureList = z.object({
  data: z.array(
    z.object({
      slug: StatsSlug,
      title: z.string(),
      description: z.string(),
      span: z.enum(['release', 'releases']),
      unit: z.enum(['variants', 'SCVs']),
      options: z.record(z.string(), z.string()),
    }),
  ),
});

/**
 * The releases a trend counts, oldest first: every release up to `last`, or the last release of
 * each month (a month's state at its end; the current month's is the latest).
 */
export function trendReleases(served: readonly string[], last: string, every: Every): string[] {
  const upTo = [...served].filter((r) => r <= last).sort();
  if (every === 'release') return upTo;
  return upTo.filter((r, i) => upTo[i + 1]?.slice(0, 7) !== r.slice(0, 7));
}

/**
 * A figure's options from a request: its defaults, overridden by what was asked for. Asking for
 * an option the figure doesn't take is an error, so a URL never seems to apply one that wasn't.
 */
export function statsOptions(
  figure: StatsFigure,
  query: Omit<StatsQuery, 'release' | 'format'>,
):
  | { ok: true; options: StatsOptions }
  | { ok: false; problems: { path: string; message: string }[] } {
  const problems: { path: string; message: string }[] = [];
  const options: StatsOptions = { ...figure.defaults };
  for (const key of ['every', 'conflict', 'condition_match'] as const) {
    if (query[key] === undefined) continue;
    if (!takesOption(figure, key)) {
      problems.push({ path: `querystring/${key}`, message: `${figure.slug} doesn't take ${key}.` });
    }
  }
  if (query.every !== undefined) options.every = query.every;
  if (query.conflict !== undefined) options.conflict = query.conflict;
  if (options.conflict === 'pairs') options.condition_match = query.condition_match ?? 'strict';
  else if (query.condition_match !== undefined && takesOption(figure, 'condition_match')) {
    problems.push({
      path: 'querystring/condition_match',
      message: 'condition_match applies only with conflict=pairs.',
    });
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, options };
}
