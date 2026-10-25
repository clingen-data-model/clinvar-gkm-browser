# ClinVar GKM browser

A new web application for browsing, filtering and searching ClinVar in ways the NCBI site doesn't support: submission-level (SCV) search and facets, conflict views down to submitter-versus-submitter, and release history. It's also a place to trial features we may propose to NCBI. Data comes from [ClinVar-GKM](https://dataexchange.clinicalgenome.org/clinvar-gkm/data-access/download/), ClinVar in GA4GH formats, published weekly as parquet.

M0 (data spike) in progress: the derived DuckDB schema and its loader are in `packages/derive/sql/`, run by `scripts/fetch-source.sh` and `scripts/derive.sh` (see [docs/schema.md](docs/schema.md)). No app code yet.

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
