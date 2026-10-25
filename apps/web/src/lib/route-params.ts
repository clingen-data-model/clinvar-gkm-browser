import { notFound } from '@tanstack/react-router';
import { ApiError } from './api/client.ts';

/** Path params for /<entity>/$id: a positive integer, or the page is not found. */
export const idParams = {
  parse: ({ id }: { id: string }) => {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) throw notFound();
    return { id: n };
  },
  stringify: ({ id }: { id: number }) => ({ id: String(id) }),
};

/** Turns an API 404 into the router's not-found page; other errors go to the error page. */
export async function orNotFound<T>(load: Promise<T>): Promise<T> {
  try {
    return await load;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) throw notFound();
    throw error;
  }
}
