# ClinVar GKM browser: API

Status: draft, 25 October 2026. The REST API the web app uses and other programs can use: the resources, the shared filter language, summaries (crosstabs), conflict pairs, paging, formats and errors, and how the server turns a request into SQL. Endpoint names and parameters are a first design; the principles are what to hold on to. The tables behind it are in [schema.md](schema.md). The features built on it, and their order, are in [features.md](features.md#build-order).

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
- repeated parameters mean OR (`submitter=500031&submitter=26957`);
- different parameters mean AND;
- a `not.` prefix negates (`not.submitter=500031`).

| Filter | Applies to | Meaning |
| --- | --- | --- |
| `release` | all | ClinVar release date; default latest |
| `variant` | SCVs, variants | variation ID |
| `gene` | SCVs, variants | NCBI gene ID, through the variant's gene list |
| `gene_relationship` | SCVs, variants | `within` (default: located within the gene, alone or with overlapping genes), `single`, or `any` (also CNVs spanning the gene, and variants near it) |
| `variant_type`, `consequence` | SCVs, variants | ClinVar variation type; molecular consequence (SO term) |
| `region` | SCVs, variants | `chr17:43044295-43125483` (GRCh38) |
| `submitter` | SCVs | submitter ID |
| `classification_type` | SCVs, variants | `PATH` (default), `ONCO`, `SCI`, `DR`, … or `any` |
| `classification` | SCVs | normalized term code (`pathogenic`, `likely_benign`, `uncertain_significance`, …) |
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
- **Classification terms are normalized.** ClinVar's submitted terms vary in case and wording (`Pathogenic`, `pathogenic`, `Pathogenic, low penetrance`, `Uncertain significance`, the VUS sub-tiers). A derived vocabulary table maps each submitted term to a normalized code, a bucket and a rank. Filters and groupings use the codes, and responses carry both the code and ClinVar's original text. This table doesn't exist yet; it comes first in the build order.

## Summaries

`/scvs/summary`, `/variants/summary` and `/scv-pairs/summary` take the same filters as the matching list, plus:
- `group_by`: one or two dimensions;
- `measure`: what to count (`scvs`, `variants`, `submitters`, `genes`, `conditions`), several allowed.

Dimensions: `gene`, `condition`, `submitter`, `classification`, `bucket`, `classification_type`, `stars`, `review_status`, `submission_level`, `method`, `variant_type`, `consequence`, `year_evaluated`, `year_submitted`. Pairs add `a.*` and `b.*` versions and `conflict_level`.

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
  - `same_condition` (default `true`: the two SCVs share a condition, after MONDO normalization where available);
  - `distinct_submitters` (default `true`).
- **Each pair is listed once,** ordered `a.scv_id < b.scv_id`, unless side filters make `a` and `b` mean different things. Then pairs are directed: `a` matches the `a.` filters.

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

## Open questions

1. **Classification normalization:** the mapping rules and the conflict-level ranks, with the VUS sub-tiers and the somatic lanes. Needs input from curators.
2. **`gene_relationship` default.** Provisionally (25 October 2026), a gene's variants are those located within it: ClinVar's "within single gene" and "within multiple genes by overlap". The second can't be dropped: HFE c.187C>G (H63D) is "multiple genes" only because HFE overlaps its antisense gene HFE-AS1. ClinVar Miner merged antisense genes for the same reason. Large CNVs spanning whole genes ("genes overlapped by variant") and variants near a gene are left out. The filter would take `within` (default), `single` or `any`.
3. **MONDO rollups** (ClinVar Miner's "variants by MONDO condition") need the MONDO hierarchy, which isn't in ClinVar-GKM. A new external source to download and version.
4. **Offset paging** is simple, but slows for deep pages on large results. Fine for the UI; exports stream instead. Revisit if API users page deep.
