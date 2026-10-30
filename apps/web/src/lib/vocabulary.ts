import { useSuspenseQuery } from '@tanstack/react-query';
import { vocabulariesQuery } from './api/queries.ts';
import { useRelease } from './release.ts';

/** Classification type labels by code, e.g. PATH -> Pathogenicity. */
export function useTypeLabels(): Map<string, string> {
  const release = useRelease();
  const { data } = useSuspenseQuery(vocabulariesQuery(release));
  return new Map(data.data.classificationTypes.map((t) => [t.code, t.label]));
}
