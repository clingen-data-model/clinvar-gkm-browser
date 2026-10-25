import { createFileRoute } from '@tanstack/react-router';
import {
  EntityConflicts,
  prefetchEntityConflicts,
} from '../components/conflicts/EntityConflicts.tsx';
import { ConflictSearch } from '../lib/conflicts.ts';

/** Conflicts among the submissions for a condition. */
export const Route = createFileRoute('/conditions/$id/conflicts')({
  validateSearch: ConflictSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ context: { queryClient }, params, deps }) =>
    prefetchEntityConflicts(queryClient, { condition: params.id }, deps),
  component: ConditionConflicts,
});

function ConditionConflicts() {
  const { id } = Route.useParams();
  return <EntityConflicts filters={{ condition: id }} search={Route.useSearch()} />;
}
