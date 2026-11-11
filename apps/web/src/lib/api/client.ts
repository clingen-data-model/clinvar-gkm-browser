// Fetches from the API on the page's own origin and parses each response with its shared schema,
// so data is typed without assertions and contract drift fails loudly.

import { ProblemDetails } from '@cvb/shared/api';
import type { z } from 'zod';

const BASE = '/api/v1';

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string | null;
  /** When the release asked for isn't served: the releases that are. */
  readonly releases: string[] | undefined;

  constructor(status: number, path: string, problem: ProblemDetails | null) {
    const detail = problem?.detail ?? null;
    super(detail ?? `The API answered ${String(status)} for ${path}`);
    this.status = status;
    this.detail = detail;
    this.releases = problem?.releases;
  }
}

export type Params = Record<string, string | number | readonly (string | number)[] | undefined>;

/** A query string from params; arrays repeat the key, undefined values are left out. */
export function queryString(params: Params): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) search.append(key, String(v));
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

export async function getJson<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  params: Params = {},
): Promise<z.output<Schema>> {
  const url = `${BASE}${path}${queryString(params)}`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    const problem = ProblemDetails.safeParse(await response.json().catch(() => null));
    throw new ApiError(response.status, url, problem.success ? problem.data : null);
  }
  return schema.parse(await response.json());
}
