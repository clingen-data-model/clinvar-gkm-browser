import { STATS_FIGURES, type StatsFigure } from '@cvb/shared/api';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Page } from '../components/shell/Page.tsx';
import { FigureChart, releasesText } from '../components/stats/FigureView.tsx';
import { releasesQuery, statsQuery } from '../lib/api/queries.ts';
import { useRelease } from '../lib/release.ts';

/**
 * Every figure with its default options, one section each, its id the figure's slug, so
 * /stats#<slug> links to it. Each figure loads on its own, so the first is up before the last.
 */
export const Route = createFileRoute('/stats/')({
  // The release isn't in loaderDeps (lib/route-search.ts), so rerun on every change of it.
  shouldReload: true,
  loader: ({ context: { queryClient, release } }) => {
    // Not awaited: each section shows its figure when it arrives.
    for (const f of STATS_FIGURES) {
      queryClient.query(statsQuery(release, f.slug, {})).catch(() => undefined);
    }
  },
  component: StatsPage,
});

function StatsPage() {
  const earliest = useQuery(releasesQuery()).data?.data[0]?.clinvarRelease;
  return (
    <Page
      title="Statistics"
      subtitle="Whole-ClinVar figures for slides, papers and grant applications, each with its numbers, definitions and a citation."
    >
      <div className="max-w-3xl space-y-3 text-sm">
        <p>
          All figures count germline pathogenicity classifications, as of the release chosen in the
          header; trends run up to it
          {earliest === undefined ? '' : `, from the earliest release served, ${earliest}`}. Each
          figure’s page has its options, the numbers behind it, exactly what each category contains,
          and downloads.
        </p>
        <nav aria-label="Figures">
          <ul className="list-disc pl-6">
            {STATS_FIGURES.map((f) => (
              <li key={f.slug}>
                <a href={`#${f.slug}`}>{f.title}</a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      {STATS_FIGURES.map((f) => (
        <FigureSection key={f.slug} figure={f} />
      ))}
    </Page>
  );
}

function FigureSection({ figure }: { figure: StatsFigure }) {
  const release = useRelease();
  const query = useQuery(statsQuery(release, figure.slug, {}));
  return (
    <section id={figure.slug} aria-labelledby={`${figure.slug}-title`} className="mt-12">
      <h2 id={`${figure.slug}-title`} className="text-xl">
        <Link
          to="/stats/$slug"
          params={{ slug: figure.slug }}
          search={(s) => ({ release: s.release })}
        >
          {figure.title}
        </Link>
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        {figure.description}
        {query.data === undefined ? null : ` ${releasesText(query.data)}.`}
      </p>
      <div className="mt-4">
        {query.data !== undefined ? (
          <FigureChart data={query.data} />
        ) : query.isError ? (
          <p className="text-sm">This figure couldn’t be loaded: {query.error.message}</p>
        ) : (
          <p className="text-sm text-muted-foreground" aria-busy="true">
            Counting…
          </p>
        )}
      </div>
      <p className="mt-2 text-sm">
        <Link
          to="/stats/$slug"
          params={{ slug: figure.slug }}
          search={(s) => ({ release: s.release })}
        >
          Options, numbers, definitions and citation
        </Link>
      </p>
    </section>
  );
}
