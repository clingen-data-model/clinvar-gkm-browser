# ClinVar GKM browser: API

Status: draft, 25 October 2026. Phase 2's additions are planned in [Phase 2 plan](#phase-2-plan-clinvar-miners-features-on-this-api). **Built so far:** releases, entity items (variants, SCVs, genes, submitters, conditions), `/variants/{id}/scvs`, `/scvs` and `/scvs/summary` over the shared filter and dimension registries (`packages/shared/src/query`), `/search`, and `/vocabularies`. Not yet: `/variants` lists and summaries, `/scv-pairs`, export formats, `POST /query`, local-only endpoints. The REST API the web app uses and other programs can use: the resources, the shared filter language, summaries (crosstabs), conflict pairs, paging, formats and errors, and how the server turns a request into SQL. Endpoint names and parameters are a first design; the principles are what to hold on to. The tables behind it are in [schema.md](schema.md). The features built on it, and their order, are in [features.md](features.md#build-order).

## Principles

- **A few general building blocks, not one endpoint per page.** ClinVar Miner's 54 pages reduce to four kinds of query: look up an entity, list rows matching filters, count rows grouped by one or two dimensions, and the same for pairs of submissions on one variant. The API offers those four over every entity, with one filter language. A Miner page is the web app calling them with preset parameters. A new feature is usually a new filter or dimension, not a new endpoint.
- **One query model, compiled once.** Every request becomes a `QuerySpec` (resource, filters, grouping, sort, page), a Zod-validated structure in `packages/shared`. A compiler turns it into parameterized SQL. URL parameters and JSON request bodies are two encodings of the same spec. Because the compiler is browser-safe, an in-browser engine could run the same specs later ([architecture.md](architecture.md#staged-path)).
- **Stable identifiers and codes.** Paths use `variation_id`, `scv_id`, `gene_id`, `condition_id`, `submitter_id`. Filter values use vocabulary codes (`PATH`, `CP`, `P`), never display labels.
- **Every response says which release it came from.**
- **Read-only and release-scoped.** Public endpoints only read. Local-only endpoints (data management, SQL console, uploaded lists) live in their own namespaces, so a hosted version can turn them off or put them behind authentication ([local-app.md](local-app.md#designing-for-a-hosted-version-later)).
- **Contracts as in gencc:**
  - one Zod schema per request and response, validating both on the server and parsing responses in the browser;
  - OpenAPI generated from them at `/api/v1/openapi.json`, browsable at `/api/v1/docs`;
  - RFC 9457 `application/problem+json` errors.

## Resources

All under `/api/v1`. `{id}` is the integer ID unless noted.

| Resource | Item | List | Summary | Notes |
| --- | --- | --- | --- | --- |
| Releases | `/releases/{date}` | `/releases` | | manifest, row counts, `reference_issue` summary |
| Variants | `/variants/{variation_id}` | `/variants` | `/variants/summary` | a variant matches if it has at least one SCV matching the SCV filters (plus variant filters) |
| Submissions (SCVs) | `/scvs/{scv_id}` | `/scvs` | `/scvs/summary` | the main analytical resource |
| SCV pairs | | `/scv-pairs` | `/scv-pairs/summary` | two SCVs on the same variant; conflicts ([below](#scv-pairs-and-conflicts)) |
| Genes | `/genes/{gene_id}` | `/genes` | | list supports `q` (symbol prefix) |
| Conditions | `/conditions/{condition_id}` | `/conditions` | | `q` (name or alias prefix), cross-references |
| Submitters | `/submitters/{submitter_id}` | `/submitters` | | `q` (name prefix) |
| Aggregates | `/variants/{id}/aggregates`, `/rcvs/{accession}` | | | VCV and RCV statement trees |
| Vocabularies | `/vocabularies/{name}` | `/vocabularies` | | classification types, terms and buckets, review statuses and stars, submission levels, collection methods, variant types, consequences |
| Search | | `/search?q=` | | detects the input's shape (accession, rsID, HGVS, name) and returns typed matches |

**Sub-resources** are shortcuts for a list with one filter fixed. `/variants/{id}/scvs` is `/scvs?variant={id}`, and `/genes/{id}/variants` is `/variants?gene={id}`. They exist for readable links; the list endpoint does the work.

**Item responses** include what a detail page needs in one request. A variant comes with its MANE HGVS, genes, VRS member, cross-references, aggregate calls per classification type, and SCV counts by classification bucket. Lists return compact rows.

## Filters

One vocabulary, shared by every list and summary endpoint that has the field. In URLs:
- repeated parameters mean OR (`submitter=500031&submitter=26957`), and so do comma-separated values (`submitter=500031,26957`), except in free-text filters (`review_status`, `variant_type`, `method`, `comment`), whose values contain commas (`criteria provided, single submitter`): repeat those;
- an empty value is an error, not a filter that matches nothing;
- different parameters mean AND;
- a `not.` prefix negates (`not.submitter=500031`).

| Filter | Applies to | Meaning |
| --- | --- | --- |
| `release` | all | ClinVar release date; default latest |
| `variant` | SCVs, variants | variation ID |
| `gene` | SCVs, variants | NCBI gene ID, through the variant's gene list |
| `gene_relationship` | SCVs, variants | which relationships to the gene count, any of `single`, `overlap`, `spanning`, `near`, `asserted` (default `single,overlap`; see open question 2) |
| `variant_type`, `consequence` | SCVs, variants | ClinVar variation type; molecular consequence (SO term) |
| `region` | SCVs, variants | `chr17:43044295-43125483` (GRCh38) |
| `submitter` | SCVs | submitter ID |
| `classification_type` | SCVs, variants | `PATH` (default), `ONCO`, `SCI`, `DR`, … or `any` |
| `term` | SCVs | normalized term code from the vocabulary (`p`, `lp`, `vus`, `vus-h`, `lb`, `b`, …) |
| `bucket` | SCVs | `P` (P/LP), `V` (VUS), `B` (B/LB), `O` (other), `N` (not provided) |
| `stars`, `min_stars` | SCVs | review stars, 0–4 |
| `review_status`, `submission_level` | SCVs | vocabulary codes |
| `method` | SCVs | collection method (`clinical_testing`, `research`, `curation`, …) |
| `condition` | SCVs, variants | condition ID, through `scv_condition` (sets expanded) |
| `evaluated_after`, `evaluated_before`, `submitted_after`, `submitted_before` | SCVs | dates |
| `has_comment`, `comment` | SCVs | comment present; comment contains text (slow, about 1 s) |
| `aggregate` | variants | VCV aggregate call for the classification type, e.g. `conflicting` |
| `list` | SCVs, variants | an uploaded variant list ID (local only) |

- **Variant filters on SCV queries** (`gene`, `variant_type`, `region`) select SCVs whose variant matches.
- **SCV filters on variant queries** select variants that have at least one SCV matching all of them together.
- **Classification terms are normalized.** ClinVar's submitted terms vary in case and wording (`Pathogenic`, `PATHOGENIC`, `Pathogenic, low penetrance`, the VUS sub-tiers). The `classification_term` vocabulary (from clinvar-ingest-bq-tools; [data.md](data.md#conflicts)) maps each to a term code, a significance and a bucket. Filters and groupings use the codes, and responses carry both the code and ClinVar's original text.

## Summaries

`/scvs/summary`, `/variants/summary` and `/scv-pairs/summary` take the same filters as the matching list, plus:
- `group_by`: one or two dimensions;
- `measure`: what to count (`scvs`, `variants`, `submitters`, `genes`, `conditions`), several allowed.

Dimensions: `gene`, `condition`, `submitter`, `term` (keyed `PATH:p`), `bucket`, `classification_type`, `stars`, `review_status`, `submission_level`, `method`, `variant_type`, `year_evaluated`, `year_submitted`. Pairs will add `a.*` and `b.*` versions and `conflict_level`.

```
GET /api/v1/scvs/summary?gene=672&group_by=submitter,bucket&measure=scvs
```
```json
{
  "release": "2026-10-18",
  "query": { "gene": [672], "classification_type": ["PATH"], "group_by": ["submitter", "bucket"], "measure": ["scvs"] },
  "dimensions": [
    { "name": "submitter", "labels": { "500031": "Labcorp Genetics (formerly Invitae), Labcorp" } },
    { "name": "bucket", "labels": { "P": "Pathogenic/Likely pathogenic" } }
  ],
  "rows": [ { "submitter": 500031, "bucket": "P", "scvs": 1234 } ],
  "totals": { "scvs": 98765 }
}
```

Dimension labels come once per response, not per row. Large dimensions (genes, conditions, submitters) are sorted by the measure, with `limit` and `offset` applying to the first dimension.

## SCV pairs and conflicts

A pair is two SCVs on the same variant with the same classification type. That's ClinVar Miner's comparison, which stored every pair for every release, at 31.8 GiB for 0.58M SCVs. Here pairs are computed per query; the heaviest measured case, every pair on every variant, took about 125 ms ([storage eval](research/storage-format-eval.md)).

- **Each side has its own filters:** `a.submitter`, `b.submitter`, `a.min_stars`, `b.method` and so on, for the "this submitter's SCVs vs everyone else's" views. Unprefixed filters apply to both sides. Variant filters apply to the variant.
- **Pair filters:**
  - `min_conflict_level` (0–5, on ClinVar Miner's scale in [data.md](data.md#conflicts));
  - `condition_match` (default `strict`: the two SCVs share a condition; also `wildcard` and `any`, see [Phase 2 plan](#three-resources-one-query-model));
  - `distinct_submitters` (default `true`).
- **Each pair is listed once,** unless side filters make `a` and `b` mean different things. Then pairs are directed: `a` matches the `a.` filters. Undirected pairs are oriented so `a` has the lower term code (then the lower SCV ID), so `group_by=a.term,b.term` is a triangle with each unordered pair of terms in one cell; other `a.`/`b.` dimensions are arbitrary without sides. Side filters that differ only in order (`a.submitter=1,2&b.submitter=2,1`) count as the same.

ClinVar Miner's conflict pages map onto this resource:

| ClinVar Miner page | Request |
| --- | --- |
| Conflict overview | `/variants/summary?group_by=max_conflict_level` |
| Term × term matrix | `/scv-pairs/summary?group_by=a.classification,b.classification&min_conflict_level=1` |
| Conflicts by gene | `/scv-pairs/summary?group_by=gene,conflict_level&measure=variants` |
| One submitter vs all others | `/scv-pairs/summary?a.submitter=500031&group_by=b.submitter,conflict_level` |
| Submitter vs submitter | `/scv-pairs?a.submitter=500031&b.submitter=61756&min_conflict_level=2` |

`max_conflict_level` is a variant-level dimension: the highest level among the variant's pairs, or "single submission", or "no conflict".

## Lists: paging, sorting, fields

- **Paging:** `limit` (default 50, maximum 500) and `offset`. `count=true` adds the total, which costs a second query. Exports aren't limited.
- **Sorting:** `sort=-date_last_evaluated,scv_id`. Each list documents its sortable fields, and every sort ends with the primary key so pages are stable.
- **Fields:** a fixed compact row per resource for now; a `fields` parameter later if needed.

Response envelope:
```json
{ "release": "2026-10-18", "query": { … }, "data": [ … ], "page": { "limit": 50, "offset": 0, "total": 2034787 } }
```

`query` echoes the normalized spec: defaults filled in, values canonicalized. The web app builds its "you are looking at" summary and its shareable link from it.

## Formats and export

Every list and summary endpoint can stream its full result. Choose with `format=` or the `Accept` header:

| Format | Notes |
| --- | --- |
| `json` | default; paged |
| `ndjson` | one row per line, streamed, unpaged |
| `tsv`, `csv` | streamed, unpaged; header row; optional `#` comment lines with release and query (`meta=comments`) |
| `parquet` | written by DuckDB to a temporary file, then sent |
| `xlsx` | small results only (cap to be set), for spreadsheet users |

- **Downloads carry the release in their filename:** `Content-Disposition` names like `clinvar-scvs-2026-10-18-gene672.tsv`.
- **Every response has an `X-ClinVar-Release` header.**
- **Rows stream from DuckDB as they're produced,** so exports of millions of rows don't build up in memory. Locally there are no export limits; a hosted version would set them.

## Complex queries

URL parameters cover AND of ORs, which is what pages and shared links need. For anything more complex, `POST /api/v1/query` takes a JSON `QuerySpec`: nested `and`/`or`/`not`, long ID lists (an uploaded list too big for a URL), several summaries in one request. It's the same spec the URL form compiles to, so nothing behaves differently. The response is the same as the matching GET.

## Local-only endpoints

Present in local mode, absent or behind authentication when hosted:

| Namespace | What |
| --- | --- |
| `/api/v1/admin/data` | status (downloaded source, derived releases, disk), start a download or derivation, progress (server-sent events), delete a release, settings |
| `/api/v1/sql` | the SQL console: run a read-only statement with timeout and row cap, stream or export a result, list the schema ([local-app.md](local-app.md#the-sql-console)) |
| `/api/v1/lists` | uploaded variant lists: create from VCF or IDs, match report, delete ([local-app.md](local-app.md#private-variant-lists)) |
| `/api/v1/workspace` | saved queries and settings |

## Errors and limits

- **Errors use RFC 9457 problem JSON,** with the offending parameter named: unknown filter, bad value, unknown release, a dimension a resource doesn't support.
- **Every query has a timeout** (default 30 s locally) and is cancelled when the client disconnects.
- **Releases are immutable,** so responses carry `ETag` and `Cache-Control` keyed on the release. The browser and any proxy can cache them.

## Server structure

As in gencc (`apps/server`, Fastify, Zod type provider), plus:

```
packages/shared/src/query/     QuerySpec schemas, URL <-> spec encoding, dimension and filter registry (browser-safe)
packages/shared/src/query/sql/ spec -> parameterized SQL compiler (browser-safe, no DuckDB import)
apps/server/src/db/            DuckDB instance per release: views over the parquet, connection pool, timeouts, cancellation
apps/server/src/api/<resource>/ routes: parse -> QuerySpec -> compile -> execute -> serialize
apps/server/src/export/        streaming TSV/CSV/NDJSON writers, parquet via COPY
```

- **A filter or dimension is a registry entry:** its URL name, Zod type, the tables it needs, and its SQL. Adding one doesn't touch the routes.
- **The compiler only emits joins a query needs.** A `gene` filter adds the `variant_gene` join; a `condition` grouping adds `scv_condition`. Prefixes become ranges ([search.md](search.md#lookups)). Conditions on optional joins are written as `CASE` expressions, never `AND` in `ON` clauses ([schema.md](schema.md#load-performance-what-we-learned)).
- **Tests** run the compiler against fixed specs (snapshot SQL), and run specs against a small fixture release built from a few genes.

## Phase 2 plan: ClinVar Miner's features on this API

Planned 25 October 2026, for the workflows in [features.md](features.md#what-curators-did-with-clinvar-miner).

### Three resources, one query model

Every Phase 2 view is a list or a summary over one of three row types. They share the filter and dimension registries (`packages/shared/src/query`) and the SQL compiler:

| Resource | A row is | Built from | Endpoints |
| --- | --- | --- | --- |
| SCVs | one submission | the **SCV base**: `scv` filtered by the SCV filters | `/scvs`, `/scvs/summary` (exist) |
| SCV pairs | two SCVs on the same variant and conflict-detectable classification type, with their conflict level | the **pair base**: the SCV base self-joined on variant and type, with `a.`/`b.` side filters and pair options | `/scv-pairs`, `/scv-pairs/summary` (new) |
| Variants | one variant, with its conflict status | the SCV base grouped by variant, and the pair base for conflict status | `/variants`, `/variants/summary` (new) |

The bases are SQL CTEs that the compiler emits, not separate code paths. A list pages rows of a base; a summary groups them by registered dimensions. So the six endpoints share their parsing, filters, paging, labels, export and tests.

**The pair base.**
- **Sides:** side A is SCVs matching the unprefixed filters plus the `a.` filters; side B, the unprefixed plus `b.` filters.
- **Which pairs:** one SCV from each side, on the same variant, with the same conflict-detectable classification type (pathogenicity or oncogenicity).
- **Options:**
  - `condition_match`: `strict` (default; the SCVs share a condition), `wildcard` (an SCV with only "not provided"/"not specified" matches any condition) or `any` (conditions ignored, as in ClinVar's aggregate). Decided 25 October 2026 ([features.md](features.md#open-questions), question 6);
  - `flagged` (default `exclude`: flagged SCVs are left out of pairs, decided 25 October 2026; they still appear in every SCV list, grouped separately, and responses count how many were left out);
  - `distinct_submitters` (default true; false for a lab against itself).
- **Each pair's conflict level** comes from one SQL function in the shared package, over the two terms' significance and codes ([data.md](data.md#conflicts)):
  - 5: P/LP against VUS or B/LB;
  - 3: VUS against B/LB;
  - 2: same significance, different term;
  - 1: same term, different submitted text;
  - 0: agreement.
  - Level 4 (category) has no cases now that ClinVar-GKM separates risk factor, drug response and the other types.
- **Unordered by default:** without side filters, each pair appears once (oriented by term code, then SCV ID). With side filters, pairs are directed (A is the lab, B the others).

**A variant's conflict status** is computed from the pair base, so it always agrees with the pairs. It's one of:
- `single`: no partner on side B;
- `none`: partners, all agreeing;
- the highest level of its pairs, 1 to 5.

This is ClinVar Miner's overview row.

Measured on the 2026-10-18 data:
- every pair on every variant, with levels, same-condition matching and flagged SCVs excluded: 0.45 s;
- one lab against every other lab (Labcorp: 1.4M pairs with 1,727 labs): 0.12 s.

### Changes to what exists

| Change | Why |
| --- | --- |
| **Side-prefixed filters** (`a.submitter`, `b.min_stars`, …): every SCV filter, with `a.`/`b.` prefixes, on pair and variant resources | Separate filters for each side of a comparison |
| **Pair options** `min_conflict_level`, `conflict_level`, `condition_match`, `flagged`, `distinct_submitters`, on pair and variant resources | Conflict thresholds; ClinVar Miner's "report conflict between different conditions", and two more rules |
| **Dimensions take a side:** the registry's key and join functions read columns through a per-side accessor, so `submitter`, `term`, `bucket`, `stars`, `method` also exist as `a.submitter`, `b.term`, …; plus `conflict_level` (pairs, variants) | Term × term grids; "other labs" tables |
| **More measures:** `pairs` (pair resources); variant measures by status (`single`, `none`, `level_1` … `level_5`, `conflicting`) as a `conflict_level` dimension | Scorecards and rates |
| **`match` on summaries:** a text filter on the first dimension's labels (a gene symbol, lab or condition name), case-insensitive | Per-table search on index pages and the "other labs" table; paged tables can't be searched in the browser |
| **`format=tsv` and `csv`** on every list and summary, streamed and unpaged | "Download table as spreadsheet", for work lists. The rest of export (NDJSON, parquet) stays in Phase 4 |
| **`/vocabularies`** adds conflict levels (code, label, example), relationship labels and the placeholder condition IDs | Plain-language labels and explanations next to the numbers |
| **Shares are computed in the browser** from counts and totals the API already returns; the API returns no percentages | One source of numbers; any share is count ÷ the right total |
| **Derivation:** `scv.condition_ids INTEGER[]` (all its conditions, sets expanded), `scv.condition_unspecified BOOLEAN` (its only conditions are "not provided"/"not specified"), and `condition.placeholder BOOLEAN` | Building the lists per query costs 0.8 s; as columns, the condition rules are cheap |

Entity endpoints (`/genes/{id}` and the like) stay small: header facts and counts. Their tabs use the lists and summaries above with the entity fixed, so a tab and the explorer give the same numbers.

### New endpoints

- **`GET /scv-pairs`:** rows with both SCVs embedded as compact SCV rows (submitter, term, stars, date last evaluated, conditions, comment), the variant's ID and name, and the level. Sort by level, variant, either side's date.
- **`GET /scv-pairs/summary`:** counts of pairs or variants by up to two dimensions (`a.term` × `b.term`, `b.submitter` × `conflict_level`, …).
- **`GET /variants`:** rows with the variant's name, genes, the aggregate call and stars, SCV counts by bucket, submitter count, and the conflict status under the request's filters. Sort by status, SCV count, submitter count, name.
- **`GET /variants/summary`:** variant counts by up to two dimensions: `conflict_level`, `gene`, `variant_type`, `classification_type`. (`condition` is per SCV, so it isn't a variant dimension; filter by it instead.)

No endpoint is specific to a page. Presets ("this lab against expert panels") are named sets of parameters in `packages/shared/src/presets.ts`, used by the web app, not API routes.

### Feature by feature

Each tab or page is a few requests to these endpoints; `{X}`, `{Y}` are submitter IDs, `{G}` a gene ID.

| Feature | Requests | Status |
| --- | --- | --- |
| **Submitter → Conflicts tab:** scorecard | `/variants/summary?a.submitter={X}&group_by=conflict_level` | new endpoint |
| … term × term grid against all others | `/scv-pairs/summary?a.submitter={X}&group_by=a.term,b.term` | new |
| … other labs ranked by disagreement | `/scv-pairs/summary?a.submitter={X}&group_by=b.submitter,conflict_level&measure=variants&match=…` | new |
| … against expert panels | the same with `b.submission_level=EP,PG` | side filters |
| … against itself | the same with `b.submitter={X}&distinct_submitters=false` | pair option |
| **Head-to-head** | `/variants/summary?a.submitter={X}&b.submitter={Y}&group_by=conflict_level`; `/scv-pairs/summary?…&group_by=a.term,b.term`; `/scv-pairs?a.submitter={X}&b.submitter={Y}&min_conflict_level=1` | new |
| … a grid cell's variants | `/scv-pairs?a.submitter={X}&b.submitter={Y}&a.term=lp&b.term=vus` | new |
| **Gene → Conflicts tab** | `/variants/summary?gene={G}&group_by=conflict_level`; `/scv-pairs/summary?gene={G}&group_by=a.term,b.term`; `/variants?gene={G}&min_conflict_level=2`, with each row's SCVs from `/variants/{id}/scvs` (exists) | new |
| **Condition → Conflicts tab** | the same with `condition={C}` | new |
| **Gene → Overview tab:** submitters × classification, conditions × classification | `/scvs/summary?gene={G}&group_by=submitter,bucket`; `…&group_by=condition,bucket` | **exists** |
| **Submitter → Overview tab:** genes × classification | `/scvs/summary?submitter={X}&group_by=gene,bucket` | **exists** |
| **Index pages:** genes, conditions, submitters, terms, with counts | `/scvs/summary?group_by=gene&measure=scvs,variants,submitters&match=…` | exists, plus `match` |
| … with conflict rates | `/variants/summary?group_by=gene,conflict_level` | new |
| **Comparing genes or labs** | the index requests with `gene={G1},{G2},…` | new (via the above) |
| **Explorer** over SCVs, variants or pairs | any of the six endpoints with the full filter bar; presets are URLs | partly exists |
| **Work list download** | any list with `format=tsv` | change |

### Build order within Phase 2

1. **Derivation:** `scv.condition_ids`, `scv.condition_unspecified`, `condition.placeholder`. Rebuild the release and the fixture.
2. **Shared query model:** side-prefixed filters, pair options, side-aware dimensions, the conflict-level SQL function, `match`. Unit tests for each.
3. **`/scv-pairs` and `/scv-pairs/summary`,** then **`/variants` and `/variants/summary`.** API tests against the fixture, which has conflicting HFE variants. Spot checks against ClinVar Miner running on the same genes (`~/dev/clinvar-miner-fork`), allowing for the known differences (somatic separated, flagged excluded, placeholder conditions).
4. **`format=tsv`** for lists and summaries.
5. **Web:** submitter Conflicts tab, head-to-head page, gene and condition Conflicts tabs, then the Overview tabs, index pages, explorer and presets.

## Open questions

1. **Classification normalization:** the mapping rules and the conflict-level ranks, with the VUS sub-tiers and the somatic lanes. Needs input from curators.
2. ~~`gene_relationship` default~~ Decided 25 October 2026. `gene_relationship` takes any of `single` (within the gene only), `overlap` (within the gene and an overlapping gene), `spanning` (large variants spanning the gene), `near` (upstream or downstream) and `asserted` (named by the submitter, not located by ClinVar), mapped from ClinVar's relationship types. The default is `single,overlap`: HFE c.187C>G (H63D) is "multiple genes" only because HFE overlaps its antisense gene HFE-AS1. The gene page shows counts for every relationship with a selector. In a list filtered by one gene, each row says how its variant relates to that gene and names its other genes.
3. **MONDO rollups** (ClinVar Miner's "variants by MONDO condition") need the MONDO hierarchy, which isn't in ClinVar-GKM. A new external source to download and version.
4. **Offset paging** is simple, but slows for deep pages on large results. Fine for the UI; exports stream instead. Revisit if API users page deep.
