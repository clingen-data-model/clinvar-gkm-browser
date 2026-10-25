// The composition root: builds the Fastify app from its dependencies. main.ts runs it; tests
// build it with a fixture release and call it through inject().

import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { api } from './api/routes.ts';
import type { Database } from './data/database.ts';
import { registerErrorHandling } from './http/errors.ts';
import { healthRoutes } from './http/health/routes.ts';
import { registerLocalAccess } from './http/local-access.ts';
import { registerOpenApi, registerOpenApiUi } from './http/openapi.ts';
import { registerSecurityHeaders } from './http/security-headers.ts';

export interface ServerDeps {
  db: Database;
  logger: FastifyBaseLogger;
  /** Host header values to answer (docs/local-app.md#security). */
  allowedHosts: string[];
}

export async function buildServer({ db, logger, allowedHosts }: ServerDeps) {
  const app = Fastify({
    loggerInstance: logger,
    genReqId: () => randomUUID(),
    routerOptions: { ignoreTrailingSlash: true },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  // Serializes the schema's parsed output, so keys a schema doesn't name never reach a response.
  app.setSerializerCompiler(serializerCompiler);
  registerLocalAccess(app, allowedHosts);
  registerSecurityHeaders(app);
  registerErrorHandling(app);

  // OpenAPI collects routes as they are registered, so it comes before them.
  await registerOpenApi(app);
  await app.register(healthRoutes, { db });
  await app.register(api, { prefix: '/api/v1', db });
  await registerOpenApiUi(app);

  return app;
}

export type Server = Awaited<ReturnType<typeof buildServer>>;
