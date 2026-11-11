import {
  CONFLICT_DEFINITIONS,
  ConflictDefinition,
  statsFigure,
  type StatsResponse,
  type StatsSlug,
} from '@cvb/shared/api';
import { queryString } from '../../lib/api/client.ts';
import {
  formatCount,
  formatShare,
  type Paint,
  paints,
  percent,
  roundedShares,
} from '../../lib/stats.ts';
import { LineChart, type LinePoint } from './LineChart.tsx';
import { SegmentedBar } from './SegmentedBar.tsx';
import { StackedColumns } from './StackedColumns.tsx';

/** The category a trend's lines follow, for the figures drawn as lines. */
const LINE_CATEGORY: Partial<Record<StatsSlug, string>> = {
  'vus-submissions': 'VUS',
  'clinsig-conflict-variants': 'Clinically significant conflict',
  'clinsig-conflict-submissions': 'In a clinically significant conflict',
};

/** Counts per release and category. */
function countsOf(data: StatsResponse): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const r of data.rows) {
    const release = out.get(r.release) ?? new Map<string, number>();
    out.set(r.release, release);
    release.set(r.category, (release.get(r.category) ?? 0) + r.count);
  }
  return out;
}

const sum = (m: ReadonlyMap<string, number> | undefined) =>
  [...(m ?? new Map<string, number>()).values()].reduce((a, b) => a + b, 0);

/** The releases a figure counts, as words. */
export function releasesText(data: StatsResponse): string {
  const first = data.releases[0];
  const last = data.releases.at(-1);
  if (first === undefined || last === undefined) return '';
  if (first === last) return `ClinVar ${last}`;
  return `ClinVar ${first} to ${last} (${String(data.releases.length)} releases)`;
}

/** The figure's API URL, with its options, for the CSV link and the citation. */
function apiUrl(data: StatsResponse, format?: 'csv'): string {
  return `/api/v1/stats/${data.figure}${queryString({ release: data.release, ...data.options, format })}`;
}

/** The URL of the figure's page with these options. */
export function figureUrl(data: StatsResponse, origin: string): string {
  const figure = statsFigure(data.figure);
  const defaults = new Map(Object.entries(figure.defaults).map(([k, v]) => [k, String(v)]));
  const asked = Object.fromEntries(
    Object.entries(data.options).filter(([k, v]) => defaults.get(k) !== v),
  );
  return `${origin}/stats/${data.figure}${queryString({ release: data.release, ...asked })}`;
}

/** A figure's chart (or charts), drawn from its counts. */
export function FigureChart({ data }: { data: StatsResponse }) {
  const figure = statsFigure(data.figure);
  const categories = data.categories.map((c) => c.name);
  const counts = countsOf(data);
  const host = typeof window === 'undefined' ? '' : window.location.host;
  const source = [
    `${releasesText(data)}, via ClinVar-GKM.`,
    `ClinVar GKM browser, ${host}/stats/${data.figure}`,
  ];
  const fileName = `clinvar-stats-${data.figure}-${data.release}`;
  const lineCategory = LINE_CATEGORY[data.figure];

  if (lineCategory !== undefined) {
    const points = data.releases.map((release) => {
      const m = counts.get(release);
      const part = m?.get(lineCategory) ?? 0;
      return { release, part, whole: sum(m) };
    });
    const unit = figure.unit;
    const count: LinePoint[] = points.map((p) => ({
      release: p.release,
      value: p.part,
      text: formatCount(p.part),
      detail: `of ${formatCount(p.whole)}`,
    }));
    const share: LinePoint[] = points.map((p) => ({
      release: p.release,
      value: percent(p.part, p.whole),
      text: `${percent(p.part, p.whole).toFixed(2)}%`,
      detail: `${formatCount(p.part)} of ${formatCount(p.whole)}`,
    }));
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-1 text-sm font-semibold">{`${lineCategory}: ${unit}`}</h3>
          <LineChart
            points={count}
            label={`${figure.title}, count of ${unit}`}
            source={source}
            fileName={`${fileName}-count`}
          />
        </div>
        <div>
          <h3 className="mb-1 text-sm font-semibold">{`${lineCategory}: share of all ${unit}`}</h3>
          <LineChart
            points={share}
            label={`${figure.title}, share of all ${unit}`}
            source={source}
            fileName={`${fileName}-share`}
            format={(n) => `${n.toPrecision(3).replace(/\.?0+$/, '')}%`}
          />
        </div>
      </div>
    );
  }

  if (figure.span === 'release') {
    return (
      <SegmentedBar
        categories={categories}
        counts={counts.get(data.release) ?? new Map()}
        label={`${figure.title}, ${data.release}`}
        source={source}
        fileName={fileName}
      />
    );
  }

  return (
    <StackedColumns
      categories={categories}
      columns={data.releases.map((release) => {
        const m = counts.get(release) ?? new Map<string, number>();
        return { label: release, sublabel: `${formatCount(sum(m))} ${figure.unit}`, counts: m };
      })}
      label={`${figure.title}, ${releasesText(data)}`}
      source={source}
      fileName={fileName}
    />
  );
}

/** A category's name with its color key. */
function CategoryName({ name, paint }: { name: string; paint: Paint | undefined }) {
  return (
    <span className="whitespace-nowrap">
      {paint === undefined ? null : (
        <span
          aria-hidden="true"
          className="mr-2 inline-block h-3 w-3 rounded-sm align-[-1px]"
          style={{ background: `light-dark(${paint.light}, ${paint.dark})` }}
        />
      )}
      {name}
    </span>
  );
}

/**
 * The numbers behind the chart: every category in every release, counts and shares. Releases
 * are rows when there are more of them than categories (a trend), else columns.
 */
export function FigureTable({ data }: { data: StatsResponse }) {
  const figure = statsFigure(data.figure);
  const counts = countsOf(data);
  const categories = data.categories.map((c) => c.name);
  const paint = paints(categories);
  // Lines show small shares to two places; the table matches them.
  const decimals = LINE_CATEGORY[data.figure] === undefined ? 1 : 2;
  const shares = new Map(
    data.releases.map((r) => {
      const m = counts.get(r);
      return [
        r,
        roundedShares(
          categories.map((c) => m?.get(c) ?? 0),
          decimals,
        ),
      ];
    }),
  );
  const cell = (r: string, c: string, i: number) => {
    const n = counts.get(r)?.get(c) ?? 0;
    return (
      <td key={`${r}-${c}`} className="py-1 pr-4 text-right whitespace-nowrap tabular-nums">
        {formatCount(n)}
        <span className="block text-xs text-muted-foreground">
          {formatShare(shares.get(r)?.[i] ?? 0, n, decimals)}
        </span>
      </td>
    );
  };
  const total = (r: string) => (
    <td key={`${r}-all`} className="py-1 pr-4 text-right whitespace-nowrap tabular-nums">
      {formatCount(sum(counts.get(r)))}
    </td>
  );
  const head = 'py-1 pr-4 font-normal';
  const caption = `${figure.title}: ${figure.unit} per category, and each category’s share of the release’s ${figure.unit}, rounded so a release’s shares add up to 100%.`;
  const byRelease = data.releases.length > categories.length;
  return (
    <div className="overflow-x-auto">
      <table className="text-sm">
        <caption className="mb-2 max-w-3xl text-left text-muted-foreground">{caption}</caption>
        {byRelease ? (
          <>
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th scope="col" className={head}>
                  Release
                </th>
                {categories.map((c) => (
                  <th key={c} scope="col" className={`${head} text-right`}>
                    <CategoryName name={c} paint={paint.get(c)} />
                  </th>
                ))}
                <th scope="col" className={`${head} text-right`}>
                  All {figure.unit}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.releases.map((r) => (
                <tr key={r} className="border-b border-border align-top">
                  <th scope="row" className="py-1 pr-4 text-left font-normal whitespace-nowrap">
                    {r}
                  </th>
                  {categories.map((c, i) => cell(r, c, i))}
                  {total(r)}
                </tr>
              ))}
            </tbody>
          </>
        ) : (
          <>
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th scope="col" className={head}>
                  Category
                </th>
                {data.releases.map((r) => (
                  <th key={r} scope="col" className={`${head} text-right whitespace-nowrap`}>
                    {r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map((c, i) => (
                <tr key={c} className="border-b border-border align-top">
                  <th scope="row" className="py-1 pr-4 text-left font-normal">
                    <CategoryName name={c} paint={paint.get(c)} />
                  </th>
                  {data.releases.map((r) => cell(r, c, i))}
                </tr>
              ))}
              <tr>
                <th scope="row" className="py-1 pr-4 text-left font-normal text-muted-foreground">
                  All {figure.unit}
                </th>
                {data.releases.map((r) => total(r))}
              </tr>
            </tbody>
          </>
        )}
      </table>
    </div>
  );
}

/**
 * What each category contains in the release shown (a trend's last): its rule, and every label
 * counted in it with its count, so a cited number can be checked and regrouped.
 */
export function CategoryContents({ data }: { data: StatsResponse }) {
  const shown = data.releases.at(-1) ?? data.release;
  const rows = data.rows.filter((r) => r.release === shown);
  const paint = paints(data.categories.map((c) => c.name));
  return (
    <table className="text-sm">
      <caption className="mb-2 text-left text-muted-foreground">
        {`What each category contains in ${shown}, with what was counted in it.`}
      </caption>
      <thead>
        <tr className="border-b border-border text-left text-muted-foreground">
          <th scope="col" className="py-1 pr-4 font-normal">
            Category
          </th>
          <th scope="col" className="py-1 pr-4 font-normal">
            Rule
          </th>
          <th scope="col" className="py-1 font-normal">
            Counted in it
          </th>
        </tr>
      </thead>
      <tbody>
        {data.categories.map((c) => {
          const p = paint.get(c.name);
          const labels = rows
            .filter((r) => r.category === c.name && r.label !== null)
            .sort((a, b) => b.count - a.count);
          return (
            <tr key={c.name} className="border-b border-border align-top">
              <th scope="row" className="py-1 pr-4 text-left font-normal">
                <CategoryName name={c.name} paint={p} />
              </th>
              <td className="py-1 pr-4">{c.rule}</td>
              <td className="py-1">
                {labels.length === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <ul>
                    {labels.map((l) => (
                      <li key={l.label}>
                        {l.label}{' '}
                        <span className="text-muted-foreground tabular-nums">
                          {formatCount(l.count)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const BQ_TOOLS =
  'https://github.com/clingen-data-model/clinvar-ingest-bq-tools/blob/2ca57d89bf1d9e93a68d01bf43fac5c02fdc0dc8/scripts/dataset-preparation/00-setup-translation-tables.sql#L30-L99';
const STATS_DOC =
  'https://github.com/clingen-data-model/clinvar-gkm-browser/blob/main/docs/stats.md';

const CLASSIFICATION_NOTE = (
  <p>
    A variant’s aggregate classification is ClinVar’s, for germline pathogenicity: one term, or its
    contributing submissions’ terms joined with “/”. Categories follow each term’s significance,
    strength and penetrance in ClinGen’s <a href={BQ_TOOLS}>clinvar-ingest-bq-tools vocabulary</a>.
    A conflict is split by whether a contributing submission is on the pathogenic side. Anything no
    rule covers would show as Unmapped. The table at the end lists every classification counted in
    each category.
  </p>
);

const NOTES: Partial<Record<StatsSlug, React.ReactNode>> = {
  'aggregate-classification': CLASSIFICATION_NOTE,
  'single-submitter-classification': (
    <>
      <p>
        Single-submitter variants are those whose contributing submissions (the ones at the
        submission level ClinVar computes the aggregate from) come from one submitter, and that no
        expert panel or practice guideline classified and that aren’t conflicting.
      </p>
      {CLASSIFICATION_NOTE}
    </>
  ),
  'submitter-agreement': (
    <p>
      Each variant is in the first group that applies, in the order listed. Submitters are counted
      among its contributing submissions, those at the submission level ClinVar computes the
      aggregate from, as ClinVar’s review status counts them: an older submission without assertion
      criteria beside a newer one with criteria doesn’t count as a second submitter.
    </p>
  ),
  'vus-submissions': (
    <p>
      Every germline pathogenicity submission (SCV) counts, flagged ones included, grouped by its
      term’s significance in ClinGen’s <a href={BQ_TOOLS}>clinvar-ingest-bq-tools vocabulary</a>.
    </p>
  ),
};

/** How the figure counts: its description, and the conflict definition when it has one. */
export function FigureDefinitions({ data }: { data: StatsResponse }) {
  const figure = statsFigure(data.figure);
  const parsed = ConflictDefinition.safeParse(data.options['conflict']);
  const conflict = parsed.success ? parsed.data : undefined;
  return (
    <div className="max-w-3xl space-y-2 text-sm">
      <p>{figure.description}</p>
      {NOTES[data.figure]}
      {conflict === undefined ? null : (
        <p>
          <span className="font-semibold">{CONFLICT_DEFINITIONS[conflict].label}:</span>{' '}
          {CONFLICT_DEFINITIONS[conflict].rule}
          {data.options['condition_match'] === undefined
            ? null
            : ` Conditions: ${data.options['condition_match'] === 'strict' ? 'the two SCVs share one' : data.options['condition_match'] === 'wildcard' ? 'they share one, or either has none specified' : 'any'}.`}
        </p>
      )}
      <p>
        How each figure is defined, and why: <a href={STATS_DOC}>docs/stats.md</a>.
      </p>
    </div>
  );
}

/** A citation for the figure as shown, and its data as CSV. */
export function FigureCitation({ data }: { data: StatsResponse }) {
  const figure = statsFigure(data.figure);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  // The reader's own date, as YYYY-MM-DD.
  const today = new Date().toLocaleDateString('en-CA');
  return (
    <div className="max-w-3xl space-y-2 text-sm">
      <p className="rounded border border-border bg-muted px-3 py-2 select-all">
        {`${figure.title}. ${releasesText(data)}, from ClinVar-GKM. ClinVar GKM browser, ${figureUrl(data, origin)} (accessed ${today}).`}
      </p>
      <p>
        <a href={apiUrl(data, 'csv')} download>
          Download the counts as CSV
        </a>{' '}
        <span className="text-muted-foreground">
          (release, category, label and count; or the same as <a href={apiUrl(data)}>JSON</a>, with
          each category’s rule)
        </span>
      </p>
    </div>
  );
}
