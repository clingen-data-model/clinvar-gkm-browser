# The gencc stack, as a template

Notes taken 24 October 2026 from `~/dev/gencc/gencc` (GeneCurationCoalition/gencc, at `66c5834`) and `~/dev/gencc/gencc-rewrite-overview.md`. Paths are relative to the gencc repo. This is what we'd copy, adapt or leave behind; [stack.md](../stack.md) records what we decide.

## Layout

- `apps/server`: Fastify. `src/main.ts` is the entry point; `server.ts` builds the app from its dependencies (`buildServer(deps)`, driven in tests with `inject()`); `config.ts` holds a Zod env schema. Folders: `http/` (errors, security headers, OpenAPI, health), `pages/` (SPA serving, CSP, redirects), `public/<feature>/` (each with `queries.ts`, `project.ts`, `routes.ts` and pure helpers), `downloads/`, `lib/`. Integration tests in `test/`.
- `apps/search`: Vite + React SPA.
- `packages/shared`: browser-safe code in subpath exports (`./public-api`, `./url-state`, `./hrefs`, `./vocabulary`, `./text`, `./page-titles`).
- `packages/db`: generated Kysely types and `createDb` (MySQL-specific).
- `fixtures/`: MySQL loader, sanitize/grants SQL, seed (MySQL-specific).
- `e2e/`: Playwright specs, plus old-vs-new parity checks.
- `deploy/Dockerfile`: multi-stage on `node:26.10.0-slim`; runs `node apps/server/src/main.ts` as `node` with `VOLUME /data`.

**Contract flow:** one Zod schema in `packages/shared/src/public-api/*.ts` validates the request and response on the server (`fastify-type-provider-zod`; the serializer drops unnamed keys), becomes the OpenAPI document (`/api/v1/openapi.json`, UI at `/api/v1/docs`), and parses every response in the browser (`getJson(path, schema)`). URL-state parsers in `packages/shared/src/url-state/` are shared by page routes and the API.

## Tooling

- **Pinning:** `.node-version` 26.10.0, `engines` `>=26.10.0 <27`, `packageManager` `pnpm@12.13.0`.
- **Supply chain:** `pnpm-workspace.yaml` sets `saveExact`, `minimumReleaseAge: 10080` (7 days), `strictDepBuilds` (unapproved install scripts fail the install; approvals in `allowBuilds`), `engineStrict`.
- **TypeScript 6.0.x** (typescript-eslint supports `<6.1`). The server runs `.ts` directly with Node's type stripping; no build step. `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, `noEmit`. Internal packages are source-only (`exports` point at `.ts`).
- **Lint/format:** ESLint 10 flat config loaded by type stripping; strictTypeChecked, no type assertions, exhaustive switches, import-boundary rules (only `queries.ts` touches the DB, only routes touch Fastify, shared code is browser-safe). Prettier (`singleQuote`, `printWidth: 100`).
- **Tests:** Vitest projects per package, DB tests behind an env flag and run against the real database; Playwright 1.62.1 (Chromium) with `@axe-core/playwright`.
- **Key versions:** fastify 5.12.7, fastify-type-provider-zod 7.0.0, @fastify/static 10.1.6, @fastify/swagger 9.9.2, zod 4.6.7, react 19.3.1, @tanstack/react-router 1.170.x, @tanstack/react-query 5.104.x, @base-ui/react 1.9.0, lucide-react, tailwindcss 4.3.3, vite 8.3.4, vitest 5.0.4.
- **CI:** none yet (planned step C1 in gencc's `docs/implementation.md`).

## Frontend conventions

- TanStack Router, file-based routes with auto code splitting. Search params kept as plain strings (custom `parseSearch`/`stringifySearch`, `:` and `,` left unescaped).
- **URL is the state.** `validateSearch` uses the shared parser (`{value, hadInvalid}`); `beforeLoad` redirects to the canonical URL. No global store: URL plus TanStack Query cache.
- Route loaders prefetch; components use `useSuspenseQuery`.
- Hand-built components (shell, filters, table, links), Base UI for tooltips, Lucide icons. No table library and no virtualization; server-side paging (`page`/`pageSize` ≤ 100) with real links.
- Theming: semantic tokens with `light-dark()`, `data-theme` override in localStorage, applied by an inline script before first paint.

## Server conventions

- Feature plugins (`FastifyPluginAsyncZod`) under `/api/v1/public`; health at `/-/healthz` and `/-/readyz`.
- RFC 9457 `application/problem+json` errors; a response failing its own schema is logged and returned as 500.
- Security headers set by the app: strict `'self'` CSP with inline scripts allowed by hash, nosniff, framing, COOP, referrer policy. HSTS from nginx.
- Hashed assets immutable for a year, `index.html` `no-cache`; downloads with ETag/Last-Modified/304.
- pino logging, `X-Request-Id` as `reqId`, clean SIGTERM shutdown.
- Deployed as a rootless podman quadlet, configured by Ansible that lives in another repo; images on ghcr tagged `sha-<short>`.

## Docs conventions

Each doc opens "Status: draft, <date>." and a one-paragraph scope with links to the others. Dense bullets that lead with a bold label, tables for choices (Area | Choice | Status | Notes), decisions dated inline, a closing open-questions section. `implementation.md` is a list of steps, each with **Builds / Verifies first / Check** and a "**Done, <date>.**" note; one step per commit, decisions recorded in the doc in the same commit.

## Reuse

**Copy nearly as-is:** root config (`package.json` scripts and engines, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.editorconfig`, `.prettierrc.json`, `vitest.config.ts`, `eslint.config.ts` with the DB boundary renamed); server core (`server.ts`/`main.ts` skeleton, `config.ts` pattern, `http/{errors,security-headers,openapi}.ts`, `pages/{csp,web-app}.ts`, static/SPA parts of `pages/routes.ts`, `downloads/conditional.ts`); web (`vite.config.ts`, `index.html`, `main.tsx`, `lib/{theme,history-state}.ts`, `lib/url/*`, `lib/api/client.ts`, `styles/`, `components/table/*`, shell components rebranded); shared `public-api/{page,problem}.ts` and url-state helpers; e2e config, `axe.ts`, security/theme specs; `deploy/Dockerfile` minus db/fixtures.

**Leave behind:** `packages/db`, `fixtures/`, `db:*` scripts, every `public/*` feature, vocabulary, GCS release cache, quotas, logos, ExcelJS export logic, parity suite.

**New for us:** DuckDB through `@duckdb/node-api` is a native addon. gencc chose `node:sqlite` for download quotas precisely to avoid one. Check whether its prebuilt platform packages install without a build script under `strictDepBuilds`, or need an `allowBuilds` entry.

## Known gaps in gencc worth fixing as we copy

From the overview's review section: TanStack Query has no `staleTime`; no database pool or request timeouts; no CI. The UI doc describes shadcn/TanStack Table, but neither is installed.
