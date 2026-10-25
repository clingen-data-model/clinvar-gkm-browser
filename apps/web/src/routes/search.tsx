import type { SearchResult } from '@cvb/shared/api';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { Page } from '../components/shell/Page.tsx';
import { searchQuery } from '../lib/api/queries.ts';

export const Route = createFileRoute('/search')({
  validateSearch: z.object({ q: z.string().catch('') }),
  loaderDeps: ({ search }) => ({ q: search.q.trim() }),
  loader: async ({ context, deps }) => {
    if (deps.q === '') return;
    const found = await context.queryClient.query(searchQuery(deps.q));
    // An identifier that names exactly one thing goes straight to it.
    const only = found.results.length === 1 ? found.results[0] : undefined;
    if (only !== undefined && found.recognizedAs !== 'name') throw redirect(hrefOf(only));
  },
  component: SearchPage,
});

function hrefOf(r: SearchResult) {
  switch (r.kind) {
    case 'variant':
      return { to: '/variants/$id', params: { id: r.id } } as const;
    case 'scv':
      return { to: '/scvs/$id', params: { id: r.id } } as const;
    case 'gene':
      return { to: '/genes/$id', params: { id: r.id } } as const;
    case 'condition':
      return { to: '/conditions/$id', params: { id: r.id } } as const;
    case 'submitter':
      return { to: '/submitters/$id', params: { id: r.id } } as const;
  }
}

const KIND_LABELS = {
  variant: 'Variants',
  scv: 'Submissions',
  gene: 'Genes',
  condition: 'Conditions',
  submitter: 'Submitters',
} as const;

function SearchPage() {
  const { q } = Route.useLoaderDeps();
  if (q === '') {
    return (
      <Page title="Search">
        <p>
          Type a gene, condition, submitter, accession, rsID or HGVS expression in the box above.
        </p>
      </Page>
    );
  }
  return <Results q={q} />;
}

function Results({ q }: { q: string }) {
  const { data } = useSuspenseQuery(searchQuery(q));
  const byKind = new Map<SearchResult['kind'], SearchResult[]>();
  for (const r of data.results) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r]);
  return (
    <Page
      title={`Results for “${q}”`}
      documentTitle={`Search: ${q}`}
      subtitle={`Searched as ${data.recognizedAs}`}
    >
      {data.results.length === 0 ? (
        <p>
          Nothing matched. Names match from their start; identifiers and HGVS must match exactly.
        </p>
      ) : (
        <div className="space-y-6">
          {[...byKind].map(([kind, results]) => (
            <section key={kind}>
              <h2 className="mb-2 text-lg">{KIND_LABELS[kind]}</h2>
              <ul className="space-y-1">
                {results.map((r) => (
                  <li key={`${r.kind}-${String(r.id)}`}>
                    <Link {...hrefOf(r)}>{r.label}</Link>{' '}
                    <span className="text-sm text-muted-foreground">{r.match}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Page>
  );
}
