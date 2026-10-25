# ClinVar GKM browser: plan

Status: draft, 24 October 2026. This is the starting plan for a new web application for browsing, filtering and searching ClinVar, built on the ClinVar-GKM data. It covers why we're building it, what it should do first, and the order of work. Nothing here is decided yet unless a line says so.

The other docs:
- [architecture.md](architecture.md): where queries run (server, browser or desktop app) and why.
- [local-app.md](local-app.md): the app as a container users run locally: data downloads, updates, security, laptop limits.
- [data.md](data.md): the ClinVar-GKM source data and the app's own derived data model, releases and history.
- [schema.md](schema.md): the app's DuckDB schema (DDL in `packages/derive/sql/`), how parquet is loaded into it, and load measurements.
- [api.md](api.md): the REST API: resources, the shared filter language, summaries, conflict pairs, formats, and how requests compile to SQL.
- [search.md](search.md): search tables, normalization of identifiers and HGVS, free-text and autocomplete, with prototype timings.
- [source-schema.md](source-schema.md): ClinVar-GKM's 22 parquet tables, their keys and foreign keys, the `data` JSON column, and the joins that go wrong.
- [features.md](features.md): what ClinVar Miner did, what NCBI's site doesn't do, and what we build in what order.
- [stack.md](stack.md): languages, frameworks and tooling, adapted from the gencc rewrite.
- [research/](research/): the background research these docs draw on, with sources and measurements.

## Why

- **Curators work at the submission level.** Labs compare their submissions with other labs' to find where they disagree. Studies look at interlab concordance and VUS trends, and pull variant sets by gene or condition, citing the ClinVar release they used. Tools such as ClinVar Miner showed how useful these views are ([research/clinvar-miner-and-landscape.md](research/clinvar-miner-and-landscape.md)).
- **NCBI's site still can't do much of this.** Its search returns variants (VCVs), not submissions (SCVs), so "what did this submitter say" can't be asked directly. It has no facet for submitter, date last evaluated or flagged status, no version history table, and only tabular text export.
- **We already have the data in a usable form.** ClinVar-GKM publishes ClinVar weekly as GA4GH-structured parquet, with SCV-level classifications, submitters, conditions mapped to MONDO, VRS alleles, and germline and somatic classifications kept apart.
- **A place to trial features.** NCBI has limited development time. A working tool lets us show and test ideas (SCV-level faceting, release diffs, conflict lifecycles, watchlists) before proposing them.

## Who it's for

- **Clinical lab curators and lab directors:** where does my lab disagree with others, what changed for my genes this month, which of my classifications are stale.
- **Expert panels (VCEPs, ClinGen curators):** conflicts in a gene or condition, by severity, with the submitters involved.
- **Researchers:** filtered variant and submission sets with release provenance, trends over time, bulk export.
- **NCBI and ClinGen staff:** a working prototype of features under discussion.

## Goals and non-goals

**Goals for the first public version:**

- The core submission-level views, on current data: counts by gene, condition, submitter and classification; drill-down to variant lists and then to submissions; conflict views including submitter-versus-submitter; filters that carry through every drill-down; shareable URLs.
- SCV-level search and filtering, which NCBI's site lacks.
- Germline, somatic clinical impact and oncogenicity classifications kept apart throughout. ClinVar Miner's fork mixes them.
- Every page and export says which ClinVar release it shows.
- Filtered export (TSV, and later JSON/GA4GH and parquet), with a matching documented API.
- Built so release history can be added without a rewrite (see [data.md](data.md#history)).
- Weekly updates with no manual steps.
- Distributed as a container image that users run locally with podman. It downloads ClinVar-GKM's parquet as published into a podman volume, builds its own tables from it, and keeps them current (decided 24 October 2026; see [local-app.md](local-app.md)).
- A SQL console beside the regular pages, for queries the UI and API don't cover yet.
- Private variant lists: upload a VCF or list of identifiers and match it against ClinVar without the data leaving the machine.
- Design choices that leave room for a multi-user hosted version later ([local-app.md](local-app.md#designing-for-a-hosted-version-later)).

**Not in the first version:**

- Accounts, saved searches, watchlists or alerts. These come later and need authentication (see [features.md](features.md#later)).
- Writes to ClinVar or any curation workflow.
- A downloadable desktop app (see [architecture.md](architecture.md#desktop-app)).
- A public hosted instance. Planned later, from the same image.
- Images for architectures other than the local podman machine's (linux/arm64), a GitHub repository, and ghcr.io publishing. All planned later.
- Changes to ClinVar-GKM's published format. Considered once local derivation shows what would help.
- Full release history from before ClinVar-GKM began (2026-07). It needs a backfill decision first (see [data.md](data.md#history)).
- Genome-browser views or coordinate-range queries beyond simple region filters.

## Principles

- **Precompute for the pages, compute live for the filters.** Variant, gene, condition and submitter pages read narrow, sorted, denormalized tables built once per release. Uncommon filter combinations run live against the same tables.
- **Stable identifiers in URLs:** ClinVar variation IDs, SCV accessions, NCBI gene IDs, MedGen/MONDO IDs, submitter IDs. Never names; ClinVar Miner keyed variants by HGVS name.
- **The URL is the state,** as in gencc: every filter, sort and page number is in the address.
- **One query contract.** Filters are a declarative, Zod-validated query spec, compiled to SQL in a shared package. The server runs it today; an in-browser DuckDB could run the same spec later (see [architecture.md](architecture.md#staged-path)).
- **ClinVar-GKM parquet is the input.** The app consumes the public data product, not the BigQuery tables behind it, so anyone can rebuild what we show. A one-off history backfill may be the exception.
- **Release provenance everywhere:** on pages, in exports and in API responses.
- **Faithful to upstream.** The data is shown as ClinVar and ClinVar-GKM publish it, errors included: nothing invented, dropped or repaired to fit our schema. Where it doesn't hold together, we record that and can show it ([schema.md](schema.md#faithful-to-upstream)).

## Milestones (proposed)

| # | Milestone | Contents | Exit check |
| --- | --- | --- | --- |
| M0 | Data spike | Download the current ClinVar-GKM parquet into `./data/source/`, checked against `index.json`. Derivation SQL that builds the tables in [data.md](data.md#derived-model) as parquet, run natively, with DuckDB's memory limited to 4 GB to match the podman machine. Benchmarks for the canonical queries (see [architecture.md](architecture.md#experiments)) and for reading `data` on demand ([source-schema.md](source-schema.md#what-to-do-with-data)) | Derivation time, peak memory, spill and derived file size, and p50/p95 for each canonical query, recorded in this repo |
| M1 | Skeleton | Monorepo from the gencc template ([stack.md](stack.md)), run natively; server downloads into its data directory, derives and opens the result read-only; web shell; variant page with its SCV table; search by ID, gene, condition, submitter, HGVS; release stamp; first SQL console | From an empty data directory, `pnpm dev` then one click gets to a variant page; a heavily submitted variant's page (e.g. a BRCA1 founder variant) under 300 ms server time; restarts and code changes don't re-download |
| M2 | Curator core | Gene, condition, submitter and classification pivots with drill-down; persistent filters; conflict views with the six-level conflict scale; submitter-versus-submitter | Each curator workflow in [features.md](features.md#build-order) has a way to do it, or a recorded reason not to |
| M3 | Export, API, private lists | Streamed TSV export of any list; OpenAPI docs; private variant lists (identifier lists and VCF SNVs first, then indels); SQL console with saved queries and the schema browser | A 100k-row export streams without loading in memory; a 10k-line VCF matches in seconds |
| M4 | Updates and image | In-app update check, download, derivation, validation, atomic swap, release selector; the linux/arm64 image and a podman volume ([local-app.md](local-app.md#what-the-user-does)) | Two consecutive weekly ClinVar-GKM releases picked up by a running container, unattended with auto-update on |
| M5 | History | Release-interval tables, variant and SCV timelines, release-to-release diffs | "What changed in BRCA2 since last month" answered from the UI |
| M6 | Trial features | Chosen from [features.md](features.md#trial-features) | Per feature |

M0 decides more than anything else, so it comes before any app code. **Status, 25 October 2026:** download, derivation to parquet, reference checks and validation are done ([schema.md](schema.md)), and query timings are measured ([storage eval](research/storage-format-eval.md)). Still open from M0: testing the build inside a 4 GiB podman machine.

The feature-level order is in [features.md](features.md#build-order). M1 covers phases 0–1, M2 phases 2–3, M3 phase 4, M4 items 5.1–5.2, M5 item 5.3, and M6 the trial features.

## Open questions

1. **Name and domain.** Is "ClinVar GKM browser" the public name? Where does it live (a clinicalgenome.org subdomain, clinvar-gkm.org)?
2. **Hosting, later.** A public multi-user instance from the same image is planned after local containers work. Where it runs (a VM like gencc's, or something else) can wait.
3. **History backfill.** Can we use the BigQuery temporal tables from `clinvar-ingest-bq-tools`, or NCBI's archived tab-delimited files (back to 2014), to provide history before 2026-07? See [data.md](data.md#history).
4. **Upstream changes to ClinVar-GKM, later.** We start with the published files as they are and reshape locally (decided 24 October 2026). Candidate upstream changes are listed in [data.md](data.md#asks-of-clinvar-gkm), to revisit once local derivation shows which matter.
5. **Relationship to ClinVar Miner's author.** Alex Henrie's fork is still active and ported its importer to the new XML in June 2026. Worth contacting before announcing this app.
6. **Who else is involved:** ClinGen, the ClinVar team at NCBI, and potential users for early feedback.
