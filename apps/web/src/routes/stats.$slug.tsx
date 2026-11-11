import {
  CONFLICT_DEFINITIONS,
  EVERY_LABELS,
  statsFigure,
  StatsSlug,
  takesOption,
  type StatsFigure,
} from '@cvb/shared/api';
import { useSuspenseQuery } from '@tanstack/react-query';
import {
  createFileRoute,
  Link,
  notFound,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router';
import { Page } from '../components/shell/Page.tsx';
import {
  CategoryContents,
  FigureChart,
  FigureCitation,
  FigureDefinitions,
  FigureTable,
  releasesText,
} from '../components/stats/FigureView.tsx';
import { statsQuery } from '../lib/api/queries.ts';
import { useRelease } from '../lib/release.ts';
import { searchOf } from '../lib/route-search.ts';
import { StatsSearch } from '../lib/stats.ts';

/** The options a figure takes, from the URL; others are ignored rather than sent. */
function optionsFor(figure: StatsFigure, search: StatsSearch): StatsSearch {
  const out: StatsSearch = {};
  if (search.every !== undefined && takesOption(figure, 'every')) out.every = search.every;
  if (search.conflict !== undefined && takesOption(figure, 'conflict')) {
    out.conflict = search.conflict;
  }
  if (out.conflict === 'pairs' && search.condition_match !== undefined) {
    out.condition_match = search.condition_match;
  }
  return out;
}

/** One figure with its options, the numbers behind it, what each category contains, and a citation. */
export const Route = createFileRoute('/stats/$slug')({
  params: {
    parse: ({ slug }: { slug: string }) => {
      const parsed = StatsSlug.safeParse(slug);
      if (!parsed.success) throw notFound();
      return { slug: parsed.data };
    },
    stringify: ({ slug }: { slug: StatsSlug }) => ({ slug }),
  },
  validateSearch: StatsSearch,
  // URL state isn't in loaderDeps (lib/route-search.ts), so rerun on every change of it.
  shouldReload: true,
  loader: ({ context: { queryClient, release }, params, location }) =>
    queryClient.query(
      statsQuery(
        release,
        params.slug,
        optionsFor(statsFigure(params.slug), searchOf(StatsSearch, location)),
      ),
    ),
  component: FigurePage,
});

function FigurePage() {
  const release = useRelease();
  const { slug } = Route.useParams();
  const figure = statsFigure(slug);
  const search = Route.useSearch();
  const data = useSuspenseQuery(statsQuery(release, slug, optionsFor(figure, search))).data;
  return (
    <Page
      title={figure.title}
      eyebrow="Statistics"
      subtitle={`${figure.description} ${releasesText(data)}.`}
    >
      <p className="mb-4 text-sm">
        <Link to="/stats" hash={slug} search={(s) => ({ release: s.release })}>
          All figures
        </Link>
      </p>
      <FigureOptions figure={figure} />
      <div className="mt-4">
        <FigureChart data={data} />
      </div>
      <h2 className="mt-10 text-xl">Definitions</h2>
      <div className="mt-2">
        <FigureDefinitions data={data} />
      </div>
      <h2 className="mt-10 text-xl">Citing it</h2>
      <div className="mt-2">
        <FigureCitation data={data} />
      </div>
      <h2 className="mt-10 text-xl">The numbers</h2>
      <div className="mt-2">
        <FigureTable data={data} />
      </div>
      <h2 className="mt-10 text-xl">What each category contains</h2>
      <div className="mt-2">
        <CategoryContents data={data} />
      </div>
    </Page>
  );
}

const SELECT =
  'mt-0.5 rounded border border-border bg-background px-2 py-1 text-sm text-foreground';

/** The figure's options, all in the URL: which releases a trend counts, what a conflict is. */
function FigureOptions({ figure }: { figure: StatsFigure }) {
  const navigate = useNavigate();
  // The URL being loaded, so a choice shows at once while its data loads.
  const search = StatsSearch.parse(useRouterState({ select: (s) => s.location.search }));
  const set = (changes: Partial<StatsSearch>) => {
    void navigate({ to: '.', search: (s) => ({ ...s, ...changes }), replace: true });
  };
  const every = search.every ?? figure.defaults.every;
  const conflict = search.conflict ?? figure.defaults.conflict;
  if (!takesOption(figure, 'every') && !takesOption(figure, 'conflict')) return null;
  return (
    <div className="flex flex-wrap items-end gap-4">
      {takesOption(figure, 'every') ? (
        <label className="flex flex-col text-xs text-muted-foreground">
          Releases
          <select
            className={SELECT}
            value={every}
            onChange={(e) => {
              set({ every: StatsSearch.shape.every.parse(e.target.value) });
            }}
          >
            {Object.entries(EVERY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {takesOption(figure, 'conflict') ? (
        <label className="flex flex-col text-xs text-muted-foreground">
          What counts as a conflict
          <select
            className={SELECT}
            value={conflict}
            onChange={(e) => {
              set({
                conflict: StatsSearch.shape.conflict.parse(e.target.value),
                condition_match: undefined,
              });
            }}
          >
            {Object.entries(CONFLICT_DEFINITIONS).map(([value, d]) => (
              <option key={value} value={value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {conflict === 'pairs' ? (
        <label className="flex flex-col text-xs text-muted-foreground">
          Conditions of the two submissions
          <select
            className={SELECT}
            value={search.condition_match ?? 'strict'}
            onChange={(e) => {
              set({ condition_match: StatsSearch.shape.condition_match.parse(e.target.value) });
            }}
          >
            <option value="strict">Same condition</option>
            <option value="wildcard">Same, or not specified</option>
            <option value="any">Any condition</option>
          </select>
        </label>
      ) : null}
    </div>
  );
}
