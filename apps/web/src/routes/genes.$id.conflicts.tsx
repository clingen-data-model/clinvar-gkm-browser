import { createFileRoute } from '@tanstack/react-router';
import {
  EntityConflicts,
  prefetchEntityConflicts,
} from '../components/conflicts/EntityConflicts.tsx';
import { ConflictSearch } from '../lib/conflicts.ts';
import { GeneSearch, geneFilters, relationshipsOf } from '../lib/gene.ts';
import { searchOf } from '../lib/route-search.ts';

/** Conflicts among the submissions on a gene's variants (those of the selected relationships). */
export const Route = createFileRoute('/genes/$id/conflicts')({
  validateSearch: ConflictSearch,
  // URL state isn't in loaderDeps (lib/route-search.ts), so rerun on every change of it.
  shouldReload: true,
  loader: ({ context: { queryClient }, params, location }) =>
    prefetchEntityConflicts(
      queryClient,
      geneFilters(params.id, relationshipsOf(searchOf(GeneSearch, location).gene_relationship)),
      searchOf(ConflictSearch, location),
    ),
  component: GeneConflicts,
});

function GeneConflicts() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  return (
    <EntityConflicts
      filters={geneFilters(id, relationshipsOf(search.gene_relationship))}
      search={search}
    />
  );
}
