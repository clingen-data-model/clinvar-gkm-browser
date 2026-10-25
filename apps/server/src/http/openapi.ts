// The OpenAPI document, generated from the routes' Zod schemas.
// JSON at /api/v1/openapi.json, browsable at /api/v1/docs.

import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

export async function registerOpenApi(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'ClinVar GKM browser API',
        version: '1',
        description:
          'Read API over ClinVar, as published by ClinVar-GKM: variants, submissions, genes, conditions and submitters.',
      },
    },
    transform: jsonSchemaTransform,
  });
}

export async function registerOpenApiUi(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/openapi.json', { schema: { hide: true } }, () => app.swagger());
  await app.register(swaggerUi, { routePrefix: '/api/v1/docs' });
}
