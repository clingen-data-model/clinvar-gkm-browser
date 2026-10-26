# ClinVar GKM browser

A web application for browsing, filtering and comparing ClinVar submissions in ways the NCBI site doesn't support: submission-level (SCV) search and filters, conflict views down to submitter versus submitter, and, later, release history. It's also a place to trial features we may propose to NCBI.

Data comes from [ClinVar-GKM](https://dataexchange.clinicalgenome.org/clinvar-gkm/data-access/download/): ClinVar in GA4GH formats, published weekly as parquet. The app derives its own tables from each release and queries them with DuckDB.

**Status:** in development. Working now:
- search by gene, condition, submitter, variant or SCV;
- gene, condition, submitter, variant and SCV pages;
- conflict views: a submitter's scorecard, term grid and labs table, submitter versus submitter, and gene and condition conflicts;
- the REST API behind them, documented with OpenAPI.

A development instance runs on Google Cloud Run for the ClinGen team. See [docs/features.md](docs/features.md#build-order) for what comes next.

## How it works

```
ClinVar-GKM parquet (22 tables, 13 GB)
  → scripts/derive.sh: DuckDB SQL in packages/derive/sql/
  → derived parquet (32 tables, 2 GB, one directory per ClinVar release)
  → API server (Fastify + DuckDB views over the parquet) → React web app
```

The derived tables reshape upstream for querying. They use integer IDs, flatten nested fields into columns, fold propositions into their statements, and add vocabularies and a precomputed table of SCV pairs for conflict detection. [docs/upstream-vs-derived.md](docs/upstream-vs-derived.md) shows the differences side by side.

## Development

Requires:
- Node 26.10 or later (see `.node-version`);
- pnpm 12;
- the DuckDB CLI, `jq` and `curl` (for the data scripts);
- podman (for container images only).

```sh
pnpm install --frozen-lockfile

scripts/fetch-source.sh        # download ClinVar-GKM's parquet (13 GB) into data/source/<release>/
scripts/derive.sh              # build the app's tables into data/derived/1/<release>/ (about 3 minutes, up to 8 GB of memory)
pnpm dev                       # web app at http://localhost:5173, API at http://localhost:8080/api/v1 (docs at /api/v1/docs)
scripts/sql.sh                 # DuckDB shell with a view per derived table

pnpm typecheck && pnpm lint && pnpm test   # checks; the tests run against a committed fixture release
pnpm e2e                                   # Playwright and axe, against the built app over the fixture
```

You can run the app, tests and e2e without downloading anything: point it at the fixture with `CLINVAR_DATA_DIR=$PWD/apps/server/test/fixture pnpm dev` (an absolute path, since the server runs from `apps/server`). The fixture is a small release (a few genes' variants) under `apps/server/test/fixture/`. `scripts/make-fixture.sh` rebuilds it from a derived release.

The server is configured by environment variable: `PORT`, `CLINVAR_DATA_DIR`, `CLINVAR_RELEASE`, `CLINVAR_ALLOWED_HOSTS`, `DUCKDB_THREADS`, `DUCKDB_MEMORY_LIMIT` and the logging settings. The defaults suit a native run; see [docs/local-app.md](docs/local-app.md#built-for-the-container-run-natively).

## Repository layout

```
apps/server/     Fastify API; also serves the built web app
apps/web/        React SPA (Vite, TanStack Router and Query, Tailwind)
packages/shared/ Zod API contracts, the filter language and its SQL compiler (browser-safe)
packages/derive/ The derivation: schema.sql, load.sql, validate.sql, generated reference checks
e2e/             Playwright tests
deploy/          Container images: a per-release data image and an app image built on it
scripts/         Fetch, derive, SQL shell, fixture and image build scripts
docs/            Design docs and research notes
```

## Docs

- [Plan](docs/plan.md): why, who it's for, goals and milestones
- [Features](docs/features.md): existing tools, gaps in NCBI's site, build order
- [Architecture](docs/architecture.md) and [stack](docs/stack.md)
- [Data](docs/data.md): the ClinVar-GKM source, the derived model, conflicts, releases and history
- [Source schema](docs/source-schema.md), [derived schema](docs/schema.md), and [the two compared](docs/upstream-vs-derived.md)
- [API](docs/api.md): resources, filters, summaries and conflict pairs
- [Search](docs/search.md)
- [Local app](docs/local-app.md) and [deployment](docs/deploy.md)
- [Research notes](docs/research/): background research with sources and measurements

## Data sources and credits

- ClinVar data is from NCBI's [ClinVar](https://www.ncbi.nlm.nih.gov/clinvar/), via ClinGen's [ClinVar-GKM](https://dataexchange.clinicalgenome.org/clinvar-gkm/).
- The classification vocabulary and conflict groups follow ClinGen's [clinvar-ingest-bq-tools](https://github.com/clingen-data-model/clinvar-ingest-bq-tools).
- The conflict scale and many of the views follow ClinVar Miner (Henrie et al., *Human Mutation* 2018).

## License

The code is under the [MIT License](LICENSE). ClinVar data is NCBI's, as published by ClinVar-GKM; it isn't part of this repository, except for the small test fixture.
