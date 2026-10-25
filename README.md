# ClinVar GKM browser

A new web application for browsing, filtering and searching ClinVar in ways the NCBI site doesn't support: submission-level (SCV) search and facets, conflict views down to submitter-versus-submitter, and release history. It's also a place to trial features we may propose to NCBI. Data comes from [ClinVar-GKM](https://dataexchange.clinicalgenome.org/clinvar-gkm/data-access/download/), ClinVar in GA4GH formats, published weekly as parquet.

In development: the data pipeline and the API server's first endpoints work; the web app is next. See the [build order](docs/features.md#build-order).

## Development

Requires Node 26.10 or later (see `.node-version`), pnpm 12, and the DuckDB CLI (for the data scripts).

```sh
pnpm install --frozen-lockfile
scripts/fetch-source.sh        # download ClinVar-GKM's parquet (13 GB) into data/source/
scripts/derive.sh              # build the app's tables into data/derived/ (about 2.5 minutes)
pnpm dev                       # API at http://localhost:8080/api/v1, docs at /api/v1/docs
scripts/sql.sh                 # DuckDB shell over the derived tables
pnpm typecheck && pnpm lint && pnpm test
```

Configuration is by environment variable ([docs/local-app.md](docs/local-app.md#built-for-the-container-run-natively)); defaults suit a native run. Tests use a small fixture release committed under `apps/server/test/fixture/`, rebuilt from a derived release by `scripts/make-fixture.sh`.

## Docs

- [Plan](docs/plan.md): why, who for, goals, milestones, open questions
- [Architecture](docs/architecture.md): server vs in-browser DuckDB vs desktop app, and the staged path
- [Local app](docs/local-app.md): the container users run locally, its data downloads and updates
- [Data](docs/data.md): the ClinVar-GKM source, the derived model, releases and history
- [Derived schema](docs/schema.md): the app's DuckDB schema and how it's loaded
- [API](docs/api.md): resources, filters, summaries, conflict pairs, export
- [Search](docs/search.md): search tables and how queries use them
- [Source schema](docs/source-schema.md): ClinVar-GKM's parquet tables, keys and joins
- [Features](docs/features.md): existing tools, gaps in NCBI's site, priorities
- [Stack](docs/stack.md): tooling, adapted from the gencc rewrite
- [Research notes](docs/research/): background research with sources and measurements
