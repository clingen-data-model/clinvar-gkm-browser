# ClinVar GKM browser: stack

Status: draft, 24 October 2026. Languages, frameworks and tooling. The stack is similar to the one used for the GenCC website rewrite, which has worked well; notes on it, and on what to copy or leave behind, are in [research/gencc-stack.md](research/gencc-stack.md). Where we differ from gencc, the reason is given.

| Area | Choice | Status | Notes |
| --- | --- | --- | --- |
| Runtime | Node.js 26 LTS | Proposed | Same as gencc. Pinned in `.node-version` and `engines` |
| Server execution | Node's type stripping; no build step | Proposed | Same as gencc. Erasable-only TypeScript; source-only internal packages |
| Package manager | pnpm 12 workspaces | Proposed | Same as gencc, with `saveExact`, `minimumReleaseAge` (7 days), `strictDepBuilds`, `engineStrict` |
| Language | TypeScript, strict | Proposed | 6.0.x until typescript-eslint supports later versions |
| HTTP API | Fastify 5 | Proposed | Also serves the built web app and exports |
| Validation and API types | Zod 4, `fastify-type-provider-zod`, OpenAPI via `@fastify/swagger` | Proposed | Same as gencc. The filter query spec is a Zod schema in a shared package |
| Query engine | DuckDB, embedded via `@duckdb/node-api` | Proposed | **Differs from gencc** (MySQL with Kysely). Analytical group-bys and conflict self-joins over millions of rows, read from a file rebuilt each week. Native addon: check install under `strictDepBuilds` ([architecture.md](architecture.md#open-questions)) |
| SQL building | Our own query-spec-to-SQL compiler, in a browser-safe shared package | Proposed | Kysely has no maintained DuckDB dialect that we've confirmed; the compiler stays small and testable, and could run in the browser later. Parameters always bound, never interpolated |
| Derivation | SQL files run through the server's DuckDB binding, from a server subcommand and from the in-app data manager | Proposed | Turns the downloaded ClinVar-GKM parquet into the app's tables ([data.md](data.md#derived-model)). Plain SQL so it can be iterated in the DuckDB CLI during M0 |
| Frontend | React 19 SPA: Vite, TanStack Router, TanStack Query, Tailwind 4, Base UI, Lucide | Proposed | Same as gencc, including URL-as-state |
| Tables | Server-side paging first; evaluate TanStack Table and TanStack Virtual for long SCV lists | Open | gencc has neither. Our lists are much longer: one variant can have dozens of SCVs, a gene thousands of variants |
| Charts | To choose in M2 (e.g. Observable Plot, or Mosaic if an in-browser engine arrives) | Open | Crosstab heatmaps and trend lines |
| Export | Streamed TSV from DuckDB query results | Proposed | gencc's ExcelJS builds whole files in memory, too big for our lists. XLSX only for small exports, if asked for |
| Logging | Fastify's pino, to stdout and to daily or size-rotated gzipped files via `rotating-file-stream` | Proposed | [local-app.md](local-app.md#built-for-the-container-run-natively). gencc logs to stdout only |
| Tests | Vitest (unit, plus tests against a small fixture release file); Playwright with axe | Proposed | Fixture: a release file built from a small, fixed subset of genes |
| Lint and format | ESLint 10 flat config with typescript-eslint and the gencc boundary rules; Prettier | Proposed | Only query modules touch DuckDB |
| Distribution | Container image run locally with podman; data in a podman volume | Decided 24 October 2026 | [local-app.md](local-app.md). linux/arm64 for the local podman machine first; multi-arch, GitHub and ghcr.io later. Users pointed to Podman Desktop. A hosted instance from the same image later |
| Workspace state | `node:sqlite` file on the data volume | Proposed | Saved queries, uploaded list metadata, settings. As gencc's download quotas |
| SQL console editor | CodeMirror 6 with its SQL language package | Proposed | Highlighting and completion from the schema. Monaco is heavier |
| CI | GitHub Actions: typecheck, lint, tests, e2e, image build | Proposed | gencc hasn't set up CI yet; set it up here from M1 once the repo is on GitHub |

## Repository layout (proposed)

```
apps/
  server/      Fastify API, serves the web app; downloads ClinVar-GKM parquet, derives and queries
  web/         React SPA
packages/
  shared/      Zod contracts, URL state, query spec and spec-to-SQL compiler (browser-safe)
  derive/      Derivation SQL and table definitions, used by the server and its CLI
e2e/           Playwright tests
deploy/        Dockerfile
docs/          These docs and research notes
```

The derivation SQL exists from M0, before the rest; M1 wires it into the server.

## Open questions

1. Copy gencc's files and strip them, or start empty and copy file by file as each step needs them? Copying file by file keeps out GenCC-specific code; [research/gencc-stack.md](research/gencc-stack.md#reuse) lists the candidates.
2. Shared UI components between gencc and this app: not worth a shared package yet. Copy, and revisit if both keep changing the same components.
