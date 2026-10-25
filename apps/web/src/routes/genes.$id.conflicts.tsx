import { createFileRoute } from '@tanstack/react-router';
import {
  EntityConflicts,
  prefetchEntityConflicts,
} from '../components/conflicts/EntityConflicts.tsx';
import { ConflictSearch } from '../lib/conflicts.ts';
import { geneFilters, relationshipsOf } from '../lib/gene.ts';

/** Conflicts among the submissions on a gene's variants (those of the selected relationships). */
export const Route = createFileRoute('/genes/$id/conflicts')({
  validateSearch: ConflictSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ context: { queryClient }, params, deps }) =>
    prefetchEntityConflicts(
      queryClient,
      geneFilters(params.id, relationshipsOf(deps.gene_relationship)),
      deps,
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
