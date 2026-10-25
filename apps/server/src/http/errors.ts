// Every error response is RFC 9457 problem details (`application/problem+json`).

import { STATUS_CODES } from 'node:http';
import type { ProblemDetails } from '@cvb/shared/api';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';

export function problem(status: number, detail: string): ProblemDetails {
  return { type: 'about:blank', title: STATUS_CODES[status] ?? 'Error', status, detail };
}

export function sendProblem(reply: FastifyReply, body: ProblemDetails): FastifyReply {
  return reply.status(body.status).type('application/problem+json').send(body);
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return undefined;
  return typeof error.statusCode === 'number' ? error.statusCode : undefined;
}

/** Answers a not-found request with a page, or returns undefined to answer with a problem. */
export type PageNotFound = (
  request: FastifyRequest,
  reply: FastifyReply,
) => FastifyReply | undefined;

export function registerErrorHandling(app: FastifyInstance, pageNotFound?: PageNotFound): void {
  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return sendProblem(reply, {
        ...problem(400, 'The request has invalid parameters.'),
        errors: error.validation.map((issue) => ({
          path: `${error.validationContext ?? 'request'}${issue.instancePath}`,
          message: issue.message ?? 'Invalid value.',
        })),
      });
    }
    if (isResponseSerializationError(error)) {
      // A response that doesn't match its own schema is a bug: log it, never send it.
      request.log.error({ err: error, cause: error.cause }, 'response failed its schema');
      return sendProblem(reply, problem(500, 'Internal server error.'));
    }
    const status = statusOf(error);
    // 4xx, and 503 for the expected unavailable states (no data yet, a query timed out).
    if (status !== undefined && ((status >= 400 && status < 500) || status === 503)) {
      return sendProblem(reply, problem(status, error instanceof Error ? error.message : ''));
    }
    request.log.error({ err: error }, 'unhandled error');
    return sendProblem(reply, problem(500, 'Internal server error.'));
  });

  app.setNotFoundHandler(
    (request, reply) =>
      pageNotFound?.(request, reply) ??
      sendProblem(reply, problem(404, `No route for ${request.method} ${request.url}.`)),
  );
}
