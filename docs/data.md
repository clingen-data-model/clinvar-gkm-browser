# ClinVar GKM browser: data

Status: draft, 24 October 2026. The source data the app reads, the derived tables it builds from it, how releases are handled, and how history could work. Measurements and the full schema notes are in [research/clinvar-gkm-data.md](research/clinvar-gkm-data.md); the raw `DESCRIBE` output is in [research/clinvar-gkm-parquet-describe.txt](research/clinvar-gkm-parquet-describe.txt).

## Source: ClinVar-GKM

- **Where:** `https://data.clinvar-gkm.org`. `/index.json` lists version lines; `/v1/1.1/index.json` lists every file with size and sha256; there is an Atom feed. Release 1.1.0 (22 October 2026) moved every URL; the old `pub-…r2.dev` URLs now return 401.
- **Parquet:** 22 files, 13.2 GB, at `v1/1.1/parquet/`, with a `manifest.json`. Rebuilt from each weekly ClinVar release and overwritten in place, so there are no dated parquet copies. The latest at the time of writing was the 2026-10-18 release, built 2026-10-22.
- **JSON:** monthly full bundles (about 4.7 GB gzipped), weekly fulls kept for the current month, and weekly JSON deltas (2–150 MB) with manifests. History starts 2026-07.
- **Physical layout:** written by DuckDB 1.5.4, SNAPPY, row groups of about 122,880 rows, not sorted by anything. IDs are prefixed strings (`clinvar:10`, `clinvar.submission:SCV000020176.2`). A JSON `data` column holding the whole GA4GH object is 60–70% of each big file.
- **Read upstream `main` of clingen-data-model/clinvar-gkm** for current docs (a clone from 2026-08-24 was already stale), especially `docs/parquet/performance.md`, `docs/parquet/joining.md` and `docs/superpowers/plans/2026-10-17-variant-sorted-parquet.md`.

### Tables that matter

| File | Rows | Size | What it holds |
| --- | ---: | ---: | --- |
| `variation` | 4.69M | 3.9 GB | Categorical variants (one per ClinVar variation ID): name, type, HGVS list with MANE flags, gene list, cytogenetic location, cross-references (dbSNP, ClinGen CA, OMIM, UniProt) |
| `scv` | 6.85M | 3.2 GB | One per SCV version: classification, review status, submission level, collection method, assertion criteria, PubMed IDs, submitted conditions, contributions (submitter; dates submitted, created, last evaluated), comment |
| `propositionPathogenicity` | 27.9M | 1.5 GB | Links statements to variant (`subject_variant_id`), condition or condition set (`object_id`), gene context, inheritance, penetrance |
| `vcv`, `rcv` | 9.2M, 12.1M | 0.7, 0.9 GB | Aggregate statements: a root per accession and one per aggregate level, with review status and conflict explanation text |
| `vcv_evidenceLine`, `rcv_evidenceLine` | 9.4M, 12.2M | 0.5, 0.6 GB | Which SCVs contributed to each aggregate |
| `allele`, `location`, `sequenceReference`, `copyNumber*` | 4.6M, 4.2M, … | 1.1, 0.7 GB | VRS alleles and copy-number variants with GRCh38 locations |
| `condition`, `conditionSet` | 23k, 101k | small | MedGen conditions with MONDO, OMIM, Orphanet, HPO, MeSH mappings; ClinVar trait sets |
| `gene`, `submitter` | 93k, 3,565 | small | NCBI gene IDs and symbols; submitter IDs and names |
| `propositionOncogenicity`, `propositionSomaticClinicalImpact`, `evidenceLine`, `therapy*` | small | small | Somatic lanes, with AMP/ASCO/CAP tiers and therapies |

**Classification lanes:** germline (G) and somatic (S), each with a code: PATH (pathogenicity, 4.43M VCV roots), drug response, risk factor, protective, association and others; somatic ONCO (oncogenicity) and SCI (clinical impact). We keep these apart on every page.

### What's missing for our purposes

- **History.** Parquet is latest-only. JSON goes back only to 2026-07.
- **Star ratings.** No star field (upstream roadmap #99). We derive stars from review status text.
- **VCV/RCV dates.** Only SCVs carry dates.
- **Allele origin, affected status, observations, case data.** Absent (upstream roadmap #104). ClinVar Miner didn't use these much, but some users filter on allele origin.
- **Submitter details** beyond ID and name (country, organization type). ClinVar Miner scraped country from NCBI pages for its map; NCBI's `organization_summary.txt` has it.
- **A variant column on statements.** Getting from an SCV to its variant needs the 27.9M-row proposition table.
- **Molecular consequence and coordinates** are reachable only through nested structs and three joins.

None of these block M0–M3. History blocks M5.

## Derived model

The concrete DDL, load and measurements are in [schema.md](schema.md); this section is the reasoning behind them. The derivation step (run in the container after each download) reshapes the upstream tables for the pages and API. The result is still a set of separate tables with foreign keys (a star layout: `scv` in the middle, with keys out to `variant`, `submitter` and, through `scv_condition`, `condition`). The reshaping makes three kinds of change:

- **Collapse pass-through hops.** Upstream, an SCV reaches its variant through `propositionPathogenicity` (27.9M rows) and its submitter through the `contributions` array. Each SCV has one of each, so `scv` gets `variation_id` and `submitter_id` columns directly. That's a shorter path to the same foreign key, not duplication.
- **Flatten nested fields into typed columns:** review status (an entry in an `extensions` array upstream), derived stars, classification, dates (entries in `contributions`), collection method.
- **Re-key and sort:** integer IDs instead of prefixed strings (`clinvar.submission:SCV000020176.2`), and each table sorted by its main lookup key so DuckDB's per-block statistics skip irrelevant rows.

Duplicating values across tables (e.g. a variant's gene IDs or aggregate classification copied onto each SCV) is added only where M0 shows a canonical query needs it.

**When to add a derived table (decided 26 October 2026):** the app serves DuckDB over the derived parquet, and stays fast by adding a derived table where a common query keeps redoing work that doesn't depend on the request. The work is done once per release in the derivation, and the request filters the stored result instead. `scv_classification_pair` is the model ([Conflicts](#conflicts)). A request then only filters and aggregates; it doesn't join large tables or rebuild the same intermediate result. We measured the alternatives on the conflict pages (a DuckDB database file, SQLite, ClickHouse with native tables). Per-request rebuilding was the cost in every engine, and the stored table was the bigger win than any engine change. The ClickHouse experiment is kept on the `clickhouse` branch. The upstream tables stay available unchanged, as views over the downloaded parquet, for the SQL console and for fields the derived tables don't extract. The upstream tables, keys and joins are described in [source-schema.md](source-schema.md).

The derived tables don't copy upstream's `data` column (each row's full GA4GH JSON); every field they need is in the typed columns. How detail views and JSON export get the full record is open ([source-schema.md](source-schema.md#what-to-do-with-data)). Table names and columns are a first draft, to be refined in M0.

- **`variant`** (one row per ClinVar variation, sorted by `variation_id`): VCV accession and version, name, variant type, genes (IDs and symbols, with relationship type), cytoband, GRCh38 chromosome/start/end, MANE Select HGVS (c. and p.), molecular consequence, rsID, ClinGen CA ID; germline aggregate classification, review status and stars; somatic aggregates; SCV counts per lane; conflict summary (maximum conflict level, same-condition flag).
- **`scv`** (one row per current SCV, sorted by `variation_id`): accession number and version, `variation_id`, submitter ID, lane and classification type, classification as submitted and normalized, review status and stars, submission level, collection method, assertion criteria, date last evaluated, date submitted, date created, mode of inheritance, gene context, PubMed count, flagged status.
- **`scv_condition`:** SCV to condition, with MedGen and MONDO IDs, for condition pivots and same-condition conflicts.
- **`gene`, `condition`, `submitter`:** dimension tables with precomputed counts by lane and classification for list pages.
- **Crosstabs:** gene × classification, condition × classification, submitter × classification and similar, precomputed for the default filters. Non-default filters run live against `scv`.
- **`search_term`:** normalized term, kind (gene, condition, submitter, accession, rsID, HGVS), target ID and rank, sorted by term for prefix search.
- **`record_json`, maybe:** keyed GA4GH JSON for detail views and JSON export, only if reading it from `source/` on demand is too slow ([source-schema.md](source-schema.md#what-to-do-with-data)).

Expected sizes are an M0 output. Leaving out `data` and storing integers should shrink the 13.2 GB source to a small fraction; the guess is under 3 GB.

### Conflicts

**Classification vocabulary (decided 25 October 2026):** terms, significance groups, conflict-detectable types and review-status ranks come from ClinGen's BigQuery tooling, so this app agrees with the curator reports built there (clinvar-ingest-bq-tools, `scripts/dataset-preparation/00-setup-translation-tables.sql` at 2ca57d8). They're seeded in `schema.sql`, with every SCV matched to its term at load ([schema.md](schema.md)).
- **Significance:** 2 is pathogenic/likely pathogenic, including low penetrance and risk alleles; 1 is uncertain, including the VUS sub-tiers and uncertain risk allele; 0 is benign/likely benign.
- **Conflicts are only computed within pathogenicity and oncogenicity,** bq-tools' conflict-detectable types. Drug response, risk factor, somatic clinical impact and the other types never conflict.
- **bq-tools' groups map onto the ClinVar Miner scale below:** its non-clinsig conflict (VUS with B/LB) is level 3, and its clinsig conflict (P/LP with anything else) is level 5. bq-tools counts a variant as conflicting only at its top review rank; ClinVar Miner's minimum-stars filters approximate that, and we can offer both.

We keep ClinVar Miner's conflict scale, which is finer than ClinVar's three-group conflict facet. For each pair of SCVs on the same variant with the same conflict-detectable classification type:

| Level | Meaning |
| --- | --- |
| 0 | No conflict: same term, or either side "not provided" |
| 1 | Synonymous: different term, same normalized term |
| 2 | Confidence: same significance, different term (P vs LP, B vs LB, VUS vs VUS-high) |
| 3 | (Likely) benign vs VUS |
| 4 | Category: a non-ACMG term against an ACMG one (e.g. risk factor vs benign). Rare now that ClinVar-GKM separates those into their own classification types |
| 5 | Clinically significant: (likely) benign or VUS vs (likely) pathogenic |

- By default a pair counts only when both SCVs share a MONDO-normalized condition; a filter turns that off. This is ClinVar Miner's default.
- VUS sub-tiers are significance 1, like VUS, so they never make a level 3 or 5 conflict with it, only level 2.
- **Storage (decided 26 October 2026): stored pairs.** ClinVar Miner stored every pair, including each SCV paired with itself, for every release; at 0.58M SCVs that was 31.8 GiB. We store each ordered pair of different SCVs once per release in `scv_classification_pair`: 15.3M rows, 164 MB of parquet, built in seconds by the derivation. Each row carries both SCV ids, both submitters, terms, review statuses, submission levels, collection methods and dates, the pair's level, and two condition flags (they share a condition; either's condition is unspecified). The per-request options are filters on those columns:
  - the condition rule;
  - flagged exclusion;
  - side filters;
  - different submitters.

  No join is needed. Building pairs per query (a self-join of `scv`) was correct but did the same work on every request, several times per page. Labcorp's scorecard took 0.46 s that way and 0.13 s with stored pairs; its term grid and labs table went from about 0.35 s to 0.06 s; and responses were identical on 29 compared requests.
- NCBI publishes its own pairwise file monthly, `summary_of_conflicting_interpretations.txt` (about 2 GB). We can check our levels against its `Rank_diff`, but we don't depend on it: it isn't part of ClinVar-GKM and it's monthly, not weekly.

## Releases

- **The app downloads ClinVar-GKM's parquet as published** and derives its tables locally, inside the container (decided 24 October 2026). One directory of derived parquet tables per ClinVar release, named by the ClinVar release date (e.g. `2026-10-18`). [local-app.md](local-app.md#data-in-the-volume) covers the volume layout and the update flow.
- **Each update:** check ClinVar-GKM's `index.json`; download; check sha256; derive; run validation queries (row counts within expected bounds against the previous release, known variants present, no empty crosstabs); switch.
- **Release in the URL:** pages show the latest release by default and accept a `release` parameter for those on disk, so a cited view can be reproduced. A local instance keeps the last few releases (configurable); with history tables (next section), old views could be rebuilt from those instead.
- **Pinning the source:** because the published parquet is overwritten in place, the app records the source manifest and checksums in the derived file, and refuses a mix of files from different builds.

## History

History is the biggest gap a new tool can fill (see [features.md](features.md#trial-features)), and the source doesn't provide it yet.

**Model and build: see [history.md](history.md)** (revised 29 October 2026). Not snapshots: upstream's records kept as a log of each release's changes, and the derived tables with the releases each row held, updated from each weekly delta.

**Sources, in order of preference:**
1. **Going forward:** each install appends to its interval tables from every release it derives. This needs no upstream change, but an install only has history from the day it started. A shared history needs one of the sources below, published for installs to download.
2. **2026-06-27 onward:** replay ClinVar-GKM's 2026-06-27 monthly bundle and the weekly JSON deltas after it, all in the 1.1 format ([history.md](history.md#backfill)).
3. **Before 2026-06-27:** either the BigQuery temporal tables built by clingen-data-model/clinvar-ingest-bq-tools (`scripts/temporal-table-procs/`) (not public; would be a one-off export), or NCBI's archived tab-delimited `submission_summary` and `variant_summary` files, back to 2014. The tab-delimited files lack GA4GH structure but carry what the history tables track. Either way this is a one-off backfill, recorded as an exception to "ClinVar-GKM is the input".

## Asks of ClinVar-GKM

For later. We start with the published files as they are (decided 24 October 2026). These are candidate upstream changes that would simplify this app and help every other consumer, to revisit once local derivation shows which matter. The alternative to changing ClinVar-GKM's files is to publish our derived files beside them.

1. **Sort published files by their lookup key** (and consider numeric ID columns). It costs nothing at read time and makes every remote lookup cheaper.
2. **Ship the planned variant-sorted lookup files** (`2026-10-17-variant-sorted-parquet.md`).
3. **Keep dated, immutable parquet** for at least the monthly releases, so a client can pin one.
4. **Keep each file under 512 MB** so the edge cache serves it; split the big tables.
5. **Add `variation_id` to SCV, VCV and RCV rows** to drop the proposition join for the common case.
6. **Star ratings** (roadmap #99) and VCV/RCV dates.
7. **Publish parquet deltas or history tables,** so history doesn't depend on replaying JSON.

## Open questions

1. Which SCV fields count as a "change" for history: classification only, or also review status, date last evaluated, conditions, comment?
2. Whether to show SCVs from previous versions (ClinVar keeps SCV versions) or only current ones on main pages.
3. How to map ClinVar's free-text submitted conditions where there's no MONDO mapping: fall back to MedGen, or show as unmapped?
4. Region filters: GRCh38 only, or GRCh37 as well? ClinVar-GKM's VRS normalization appears GRCh38-only.
