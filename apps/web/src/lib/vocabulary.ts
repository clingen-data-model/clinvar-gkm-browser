import { useSuspenseQuery } from '@tanstack/react-query';
import { vocabulariesQuery } from './api/queries.ts';

/** Classification type labels by code, e.g. PATH -> Pathogenicity. */
export function useTypeLabels(): Map<string, string> {
  const { data } = useSuspenseQuery(vocabulariesQuery());
  return new Map(data.data.classificationTypes.map((t) => [t.code, t.label]));
}
