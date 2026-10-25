import { createFileRoute } from '@tanstack/react-router';
import {
  EntityConflicts,
  prefetchEntityConflicts,
} from '../components/conflicts/EntityConflicts.tsx';
import { ConflictSearch } from '../lib/conflicts.ts';
import { searchOf } from '../lib/route-search.ts';

/** Conflicts among the submissions for a condition. */
export const Route = createFileRoute('/conditions/$id/conflicts')({
  validateSearch: ConflictSearch,
  // URL state isn't in loaderDeps (lib/route-search.ts), so rerun on every change of it.
  shouldReload: true,
  loader: ({ context: { queryClient }, params, location }) =>
    prefetchEntityConflicts(
      queryClient,
      { condition: params.id },
      searchOf(ConflictSearch, location),
    ),
  component: ConditionConflicts,
});

function ConditionConflicts() {
  const { id } = Route.useParams();
  return <EntityConflicts filters={{ condition: id }} search={Route.useSearch()} />;
}
