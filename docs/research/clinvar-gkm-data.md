# ClinVar-GKM published data: facts for the clinvar-gkm-browser architecture decision

Researched 2026-10-24. Legend: **[M]** = measured by me from this machine (duckdb 1.5.5 CLI + curl, Boston-area
Cloudflare PoP); **[D]** = stated in ClinVar-GKM docs / upstream repo; **[I]** = my inference.

Important: the local checkout `~/dev/clinvar-gkm` is stale (last commit 2026-08-24). The live site and upstream
`main` (GitHub, 2026-10-23) describe release **1.1.0** (2026-10-22) with a new URL layout. Everything below is
for 1.1.0 unless noted. The old `pub-f0ad...r2.dev` URLs in the local docs now return **HTTP 401** [M]
(the r2.dev dev URL was disabled per ADR 0005).

---

## 1. What is published, where, how

### Host and layout [M][D]
- Host: `https://data.clinvar-gkm.org` (Cloudflare R2 behind a Cloudflare zone with CDN, WAF and rate limiting).
- Root manifest: `/index.json` lists version lines. Current line `v1/1.1` (schema 1.1.0, status current);
  `v1/1.0` frozen (1.0.1, no Parquet). A breaking change opens `v2/`; a content-only correction that rewrites
  bundles opens a new MINOR folder (`v1/1.2/`). Superseded lines are frozen and kept indefinitely.
- Line index: `/v1/1.1/index.json` (machine-readable listing: monthly, weekly, deltas, archives, parquet; sizes
  + sha256). Also `feed.xml` (Atom) and `README.txt`.
- WAF path allowlist: only `/index.json` and `/v1/...` are served; anything else gets 403 [D].

```
v1/1.1/
  index.json, feed.xml, README.txt
  clinvar-gkm_00-latest.json.gz            newest official monthly (4.73 GB gz)
  clinvar-gkm_YYYY-MM.json.gz              monthlies (2026-07 .. 2026-10, ~4.5-4.7 GB each)
  weekly/clinvar-gkm_YYYY-MMDD.json.gz     weekly fulls, CURRENT MONTH ONLY (~4.78 GB each)
  weekly/clinvar-gkm_00-latest_weekly.json.gz
  deltas/clinvar-gkm-delta_YYYY-MMDD.json.gz (+ .manifest.json)   current month; older under deltas/YYYY-MM/
  archive/YYYY/...                          prior-year monthlies + deltas
  parquet/{section}.parquet + manifest.json ONE dataset, overwritten every weekly release
```
Every bundle has a `.sha256` sidecar.

### Release cadence and versioning [M][D]
- Weekly release for every ClinVar weekly XML release, "typically within 1-2 days" [D]. Latest release on
  2026-10-24: source release **2026-10-18**, Parquet built 2026-10-22T17:58Z [M] (this one lagged 4 days,
  because 1.1.0 was cut over that week).
- Monthly full = copy of the last weekly before ClinVar's monthly cut (e.g. 2026-10 monthly = 2026-09-28 release).
- History starts **2026-07** (monthlies 2026-07..10; 16 weekly deltas 2026-07-06..2026-10-18). Backfill to 2019
  is only a roadmap idea (#107, 0 votes).
- Deltas: JSON only (no delta Parquet in 1.1.0), 1.8-153 MB gz each; the 2026-10-18 manifest lists A=147,041,
  U=68,153, D=49,259 records across sections [M]. Replay = monthly + apply deletes + upsert.

### Parquet set [M]
`/v1/1.1/parquet/manifest.json`: source_release 2026-10-18, dataset `clinvar_2026_10_18_v2_6_0`,
builder "BigQuery export", schema 1.1.0, 22 files, **13.22 GB total**, per-file sha256, provenance/licence.
**No dated or archived Parquet:** "rebuilt from the newest weekly release and overwritten in place. There are
no dated, per-delta or archived Parquet sets" [D]. A past state must be rebuilt from bundles (the
`clinvar-gkm-parquet` tool is "planned but not yet released") [D].

### HTTP behaviour [M]
| Check | Result |
|---|---|
| Public, no auth | yes |
| `Accept-Ranges: bytes`; `Range: bytes=0-99` | 206 + `Content-Range` |
| Suffix range `bytes=-8` | 206 (works) |
| GET with `Origin: https://example.com` | `Access-Control-Allow-Origin: *`, `Vary: Origin`, exposes `ETag, Content-Length, Content-Type, Content-Range, Accept-Ranges, Content-Encoding, Last-Modified` |
| OPTIONS preflight (`Access-Control-Request-Headers: range`) | 204, `allow-methods: GET, HEAD`, `allow-headers: range`, `max-age: 3600` |
| Content-Type | `application/vnd.apache.parquet` |
| ETag | multipart-style (`"...-385"` on scv), changes on each weekly overwrite |
| Cache | small files: `cf-cache-status: HIT` (edge, `cache-control: max-age=3600`, edge TTL 1 day, purged on rebuild [D]). **Files > 512 MB: `BYPASS` on every range request** (Cloudflare does not cache objects that large), so every read goes to R2 origin. |

So browser fetches (DuckDB-WASM) are technically possible from any origin. The docs site itself runs a
DuckDB-WASM 1.29.0 console against these URLs, with `SET threads=1` and `http_retries=4` [D].

### Rate limit and cost guard [D]
- Cloudflare rate-limit rule: **250 requests / 10 s per client IP; block for 10 s (HTTP 429)** (ADR 0005, live
  docs). An earlier observation recorded 429 after about 55 requests in 10 s (followups D1). The live rule has
  not been reconciled in the docs.
- R2 Class B reads cost $0.36/M after 10M/month free; reads that miss the cache (all range reads on >512 MB
  files) count. A manual **kill switch** (WAF rule blocking all of data.clinvar-gkm.org) exists for runaway
  costs, and there is a $10/month budget alert. No hard spend cap.
- Docs explicitly say: "The R2 hosting has rate limits and is designed for file downloads, not as a remote query
  endpoint ... query remotely to explore, download to analyze." For 429: "Download whole files and query them
  locally rather than issuing many small range requests."
- I did not trigger a 429 in any test. Peak was 520 requests in 70 s, about 115 in 2 s [M].

---

## 2. Parquet datasets: physical layout [M]

All files: written by **DuckDB v1.5.4** (merge of BigQuery `EXPORT DATA` shards with
`COPY ... (FORMAT PARQUET, COMPRESSION SNAPPY)`, no ORDER BY), **SNAPPY**, DuckDB default row groups
(about 122,880 rows), min/max stats present on every column chunk I checked, bloom filters only on
dictionary-encoded columns (for example `subject_variant_id`, `object_id`, `sequence_reference_id`), none on
PLAIN id columns. No key/value metadata.

| File | Rows | Row groups | Compressed | Uncompressed | Biggest columns (compressed) |
|---|---:|---:|---:|---:|---|
| variation | 4,691,827 | 38 | 3,931 MB | 22.1 GB | data 2,289 MB, extensions 960, mappings 211, constraints 167, members 164, name 103, id 37 |
| scv | 6,853,781 | 56 | 3,214 MB | 21.0 GB | data ~2.1 GB, extensions 393, classification 120, id 58, proposition_id 51, contributions 40, reportedIn 33 |
| propositionPathogenicity | 27,868,969 | 226 | 1,487 MB | 10.7 GB | data 974, id 236, subject_variant_id 209, object_id 37 |
| allele | 4,598,672 | 38 | 1,123 MB | 2.8 GB | data 584, id/location_id/digest about 160 each |
| rcv | 12,056,355 | 98 | 861 MB | 7.6 GB | |
| location | 4,215,441 | 35 | 715 MB | 1.5 GB | data 274, id 148, digest 145, loc_* about 24 each |
| vcv | 9,165,651 | 75 | 667 MB | 5.8 GB | data 404, has_evidence_lines 96, id 89, proposition_id 77 |
| rcv_evidenceLine | 12,156,097 | 99 | 644 MB | 4.3 GB | |
| vcv_evidenceLine | 9,375,111 | 77 | 512 MB | 3.4 GB | data 303, evidence_items 112, id 97 |
| conditionSet | 100,706 | 1 | 11.0 MB | 39 MB | |
| propositionClinvarCustom | 186,184 | 2 | 10.4 MB | 67 MB | |
| copyNumberCount | 47,466 | 1 | 8.7 MB | | |
| copyNumberChange | 31,722 | 1 | 5.8 MB | | |
| gene | 92,989 | 1 | 5.4 MB | 37 MB | |
| condition | 23,414 | 1 | 4.7 MB | 19 MB | |
| propositionSomaticClinicalImpact | 12,607 | 1 | 0.74 MB | | |
| propositionOncogenicity | 9,595 | 1 | 0.46 MB | | |
| submitter | 3,565 | 1 | 0.28 MB | | |
| evidenceLine (SCV, somatic SCI only) | 1,568 | 1 | 0.15 MB | | |
| sequenceReference | 214 | 1 | 29 KB | | |
| therapyGroup / therapy | 10 / 38 | 1 | <10 KB | | |

- Nine files exceed 500 MB, which is 98% of the 13.2 GB. The other 13 total about 48 MB, all edge-cacheable.
- Footers are large on the big files: about 1.3 MB for scv (3 requests: HEAD + 256 KB + 1 MB) [M].
- **Sort order: none useful.** Each row group's min/max on `id` spans almost the whole key space (for
  example variation rg0 `clinvar:1000071`..`clinvar:999890`, rg1 `clinvar:1000181`..`clinvar:999968`; scv rg0
  `SCV000020176`..`SCV008103650`; propositionPathogenicity `subject_variant_id` the same). So min/max pruning
  removes nothing, and **every point lookup reads the filter column of every row group**. Ids are strings
  (`clinvar:10`), so even a sorted file would sort lexically, not numerically. The docs confirm: "The published
  files are not sorted by any lookup key" [D].
- No variant column on statements: `scv`/`vcv`/`rcv` link to the variant only through
  `proposition_id` -> `proposition*.subject_variant_id`. The VCV/RCV id embeds the accession
  (`VCV000000010.141-G-PATH`, VCV number = variation id), so `id LIKE 'VCV000000010.%'` works without a join.

### Schemas (abbreviated) [M]
- **variation**: id, type, name, `extensions STRUCT(name, value_string, value_boolean, value_coding,
  value_hgvs_array STRUCT(nucleotideExpression{syntax,value,extensions[]}, nucleotideType, maneSelect, manePlus,
  proteinExpression{syntax,value}, molecul[...type truncated in my capture; see describe.txt])[], value_gene_array STRUCT(gene, relationship_type,
  source)[])[]`, `mappings STRUCT(coding{system,code,iris[]}, relation)[]`, `members VARCHAR[]`,
  `constraints STRUCT(type, allele, location, copies, copyChange, matchCharacteristic{...}, relations[])[]`, data.
  Extension names for clinvar:10: categoricalVariationType, definingVrsVariationType, clinvarVariationType,
  clinvarSubclassType, clinvarCytogeneticLocation, clinvarHgvsList, clinvarGeneList. Mappings include ClinVar,
  ClinGen Allele Registry, GTR, dbSNP, OMIM, UniProt.
- **allele**: id (ga4gh:VA.), type, digest, name (GRCh38 HGVS g.), location_id, data.
  **location**: id, digest, loc_start, loc_end, loc_start_min/max, loc_end_min/max, sequence_reference_id, data.
  **sequenceReference**: id (SQ.), refget_accession, name (RefSeq acc), molecule_type, residue_alphabet.
  **copyNumberCount/Change**: id, digest, copies / copy_change, location_id.
- **gene**: id (ncbigene:N), concept_type, name (symbol), data.
- **condition**: id (clinvar.trait:N), type, conceptType, name, aliases[], primaryCoding{name,code,system,iris[]}
  (MedGen), mappings[] (MONDO, OMIM, Orphanet, HPO, MeSH), data. **conditionSet**: id, conceptSetType,
  membershipOperator, concepts[], data. **therapy**/**therapyGroup**: key, value(JSON), name / members[].
- **submitter**: id (clinvar.submitter:N), type (Agent), name, data.
- **proposition\*** (four tables, one shared schema): id, type, predicate, subject_variant_id, object_id,
  object_type (condition / conditionSet / therapy / therapyGroup), condition_qualifier_id, gene_context_id,
  gene_context_name, submitted_gene_symbols[], gene_context_source, mode_of_inheritance, penetrance, data.
- **scv**: id (clinvar.submission:SCVn.v), type, `classification STRUCT(type, conceptType, name,
  primaryCoding{code,system}, extensions[])`, strength{...name}, direction, quality{name = submission level},
  description, `specifiedBy STRUCT(methodType, name, reportedIn{pmid,doi,urls[],name,documentType,...},
  extensions[])`, `reportedIn STRUCT(pmid, doi, urls[], name, documentType, extensions[])[]`,
  `extensions STRUCT(name, value_string, value_submitted_condition_set{... MedGen match detail ...},
  value_submitted_condition{...})[]`, proposition_id, proposition_section,
  `contributions STRUCT(type, contributor, date DATE, activityType)[]`, has_evidence_lines[], data.
- **vcv / rcv**: id, type, direction, strength{name}, quality{name = aggregate level},
  `classification STRUCT(type, conceptType, name, extensions STRUCT(name,value)[])`,
  `extensions STRUCT(name,value)[]` (clinvarReviewStatus), proposition_id, proposition_section,
  has_evidence_lines[], data.
- **vcv_/rcv_evidenceLine**: id (`<stmt>.contributing` / `.non-contributing`), directionOfEvidenceProvided,
  strengthOfEvidenceProvided{name}, evidence_items[], data. **evidenceLine** (SCV, somatic SCI only):
  evidenceOutcome{name = tier}, extensions, target_proposition_id.
- Full DESCRIBE output: [clinvar-gkm-parquet-describe.txt](clinvar-gkm-parquet-describe.txt). Row-group stats were in a scratch DuckDB file (not kept)
  (tables md, sch, fm, st).

---

## 3. Remote query latency (duckdb 1.5.5 CLI over HTTPS, as a proxy for DuckDB-WASM) [M]

Each query ran in a fresh process (cold, no local cache), mostly `threads=1` to match the WASM console.
Requests and bytes come from DuckDB's HTTP log. Harness: [clinvar-gkm-bench/run2.sh](clinvar-gkm-bench/run2.sh); raw logs were in a scratch directory
(not kept).

| Query | Threads | Wall | Requests | MB read | Notes |
|---|---:|---:|---:|---:|---|
| `count(*)` scv | 1 | 0.45 s | 3 | 1.3 | footer only |
| DESCRIBE scv | 1 | 0.49 s | 3 | 1.3 | |
| DESCRIBE all 22 files (one process) | 4 | 13 s | ~66 | | |
| condition `name ILIKE '%marfan%'` (13 rows) | 1 | 0.43 s | 4 | 0.6 | small file, edge HIT |
| submitter full scan | 1 | 0.32 s | 3 | 0.1 | edge HIT |
| scv point lookup by id (+2 struct fields) | 1 | 3.9 s | 28 | 25 | reads id column of all 56 RGs |
| scv `data` JSON for one id | 1 | 7.7 s | 27 | 63 | |
| vcv `data` for one id | 4 | 1.8 s | 30 | 37 | |
| vcv statements for variant 10 (`id LIKE 'VCV000000010.%'`) | 1 | 5.7 s | 40 | 33 | |
| variation point lookup `id='clinvar:10'` (id+name) | 1 | **174 s** | 44 | 40 | origin stalls |
| same, id only | 1 | **66 s** | 41 | 37 | one request took 46 s |
| variation extension names for one id | 4 | **101 s** | 44 | 68 | p95 request 82 s |
| propositions for variant `subject_variant_id='clinvar:10'` | 1 | **>300 s (timeout)** | 112 (of ~230) | 98 | stalls of 59 s, 38 s, 77 s |
| SCVs for one variant (prop -> scv join) | 8 | **71 s** | 520 | **429** | p50 121 ms, max 57 s |
| `gene_context_name='BRCA1'` count (47,656) | 1 | 82 s | 122 | 11 | one 31 s stall |
| nested filter `scv.classification.name='Pathogenic'` count (534,421) | 1 | 6.4 s | 59 | 1.5 | |
| aggregate: scv GROUP BY classification.name x quality.name | 1 | 10.9 s | 115 | 1.6 | |
| same aggregate | 8 | 2.0 s | 115 | 1.6 | |

### The decisive observation: tail latency on large files [M]
- Small files (<512 MB, edge-cached), 60 sequential curl range requests: p50 118 ms, p95 133 ms, max 138 ms.
- Large files (>512 MB, `BYPASS`, served from R2 origin), 80 sequential curl 930 KB range requests on
  propositionPathogenicity: **p50 0.26 s, p90 0.55 s, p95 5.2 s, max 58 s**. DuckDB logs show the same pattern:
  most requests take about 100 ms, but roughly 1 in 20-40 stalls for 6-77 s. So any query that touches dozens to
  hundreds of row groups of a big file will almost certainly hit several stalls. Run-to-run variance is huge:
  the same kind of point lookup took 3.9 s on scv and 66-174 s on variation.
- Parallel requests hide the stalls (8 threads: the GROUP BY dropped from 10.9 s to 2.0 s; the join finished
  where the single-threaded subquery timed out). But parallelism pushes toward the 250 req/10 s limit, and
  DuckDB-WASM in a browser does its HTTP reads effectively serially [I; the docs console uses threads=1].
- Single-stream bulk download is fast: 200 MB range of scv in 2.9 s (**68 MB/s**). The whole 13.2 GB Parquet
  set would take about 3-4 min on this link; small files edge-cached at 33 MB/s.

### What sorting would buy (documented, not measured by me) [D]
Upstream design plan `docs/superpowers/plans/2026-10-17-variant-sorted-parquet.md` ("C1", **design only, not
in the pipeline**) proposes pre-joined, key-sorted lookup files (ZSTD, 122,880-row groups, no bloom filters,
total order, about 578 MB/month total):

| File | Sort key | Rows | Size | Lookup cost |
|---|---|---:|---:|---|
| statement-by-variant | variant_id | 27.65 M | 189 MB | 10-17 requests |
| statement-by-object | concept_id (condition/therapy, incl. via sets) | 32.6 M | 237 MB | 8-16 requests |
| concept-set-membership | member_concept_id | 0.4 M | 6.4 MB | 5-9 |
| variant-gene | gene_id | 7.3 M | 24 MB | 5-7 |
| statement-by-gene-context | gene_context_id | 6.7 M | 74 MB | 4-7 |
| statement-by-citation | citation_id | ~7.9 M | ~48 MB | 7-23 |

Their measurement: PubMed ids for `clinvar:10` = **399 requests / 331 MB** on today's files vs **16 requests /
1.2 MB** with statement-by-variant. Open maintainer decisions include which files to publish, monthly vs weekly
freshness, and "sort every published section by id" (decision 9). All six are under 512 MB, so unlike today's
big files they *would* be edge-cacheable [I].
The plan also notes the published "Working at Scale" recipe: a local `scv_by_variant` table (about 650 MB DuckDB
file, built in about 30 s with a 5 GB peak) answers per-variant / per-condition questions in about 10 ms.

---

## 4. ClinVar concepts and how they map

| ClinVar concept | Where | Notes |
|---|---|---|
| Variation (VCV variation id) | `variation` (Cat-VRS CategoricalVariant), id `clinvar:<n>` | name = ClinVar preferred name; types via extensions; 4.69 M rows |
| VRS alleles / CNVs | `allele`, `copyNumberCount`, `copyNumberChange`, `location`, `sequenceReference` via `variation.members` / `constraints` | GA4GH computed ids; GRCh38 genomic HGVS on allele.name [I: VRS processing appears "noliftover"/GRCh38-centric] |
| HGVS | `variation.extensions[clinvarHgvsList].value_hgvs_array` (nucleotide + protein expressions, MANE Select/Plus flags, likely molecular consequence) | the docs search by HGVS with a list comprehension: about 4.5 s locally over 1.4 GB |
| Genes | `variation.extensions[clinvarGeneList].value_gene_array` {gene: ncbigene id, relationship_type, source} + `gene` (symbol in name); per-SCV `gene_context_id/name`, `submitted_gene_symbols` on propositions | gene_context is SCV-only (NULL on VCV/RCV propositions); docs warn gene_context_name is not a reliable gene join |
| Cytogenetic location | variation extension clinvarCytogeneticLocation | genomic coordinates require variation -> allele -> location joins |
| Cross-refs | variation.mappings (dbSNP, ClinGen CA, OMIM, UniProt, GTR, ...) | |
| SCV (submission) | `scv` row per SCV accession+version | classification.name (submitted call), strength, direction, quality.name = submission level, extensions: clinvarScvId, clinvarScvVersion, **clinvarScvReviewStatus**, submissionLevel, submittedScvLocalKey, submittedScvClassification, submitted condition(s) with MedGen match detail; description (free-text comment); specifiedBy.methodType (collection method) and name (assertion criteria); reportedIn (PMIDs/DOIs/URLs) |
| Submitter | `submitter` (3,565 orgs, id + name), linked by `scv.contributions[activityType='submitted'].contributor` | ids and names present |
| SCV dates | `scv.contributions[]`: `submitted` (date last submitted), `created` (date first created), `evaluated` (date last evaluated, may be NULL) | |
| RCV equivalent | `rcv` (12.06 M rows): one root statement per RCV accession + one per aggregate level (PG/EP/CP/NOCP/NOCL/FLAG) | classification.name = aggregate call, `conflictingExplanation` extension, clinvarReviewStatus extension; `rcv_evidenceLine` lists contributing / non-contributing SCVs |
| VCV aggregate | `vcv` (9.17 M rows), same structure; e.g. clinvar:10 has 9 VCV statements (G-PATH root, -CP, -NOCP, -FLAG, G-RF-NOCP, G-NP, G-NP-NOCL, G-OTH, G-OTH-CP) | conflicts: `classification.name='Conflicting classifications of pathogenicity'` + `conflictingExplanation` "Pathogenic(40); Likely pathogenic(2); ..." |
| Conditions / traits | `condition` (23,414, MedGen primaryCoding + MONDO/OMIM/Orphanet/HPO/MeSH mappings), `conditionSet` (100,706; ClinVar trait sets + minted sets) | proposition.object_id may point at a condition or a set; catch-alls `not provided` / `not specified` have about 7-8 M statement rows each |
| Classification types | lane G (germline) / S (somatic) + code: PATH (4.43 M VCV roots), NP, DR, OTH, RF, ASSOC, AFF, CDFS, PROTECT, CS; somatic ONCO (oncogenicity, 1,905 roots) and SCI (clinical impact, 1,317 roots; with -TR/-DIAG/-PROG evidence lines carrying AMP/ASCO/CAP tiers, therapies in therapy/therapyGroup) | |
| Review status | `clinvarScvReviewStatus` (SCV) and `clinvarReviewStatus` (VCV/RCV) as text; quality.name = level | **no star rating field** (roadmap #99 "star-level aggregate extensions", status Spec'd) [D] |
| Mode of inheritance / penetrance | proposition columns (SCV only) | |

### Gaps for ClinVar Miner-style features
- **Per-release history:** Parquet is latest-only, overwritten weekly. History exists only as JSON bundles from
  **2026-07** onward (monthlies + weekly deltas); weekly fulls are deleted at month end. No SCV/VCV change log in
  Parquet. Upstream BigQuery does have temporal tables built by `~/dev/clinvar-ingest-bq-tools/scripts/temporal-table-procs/`
  (clinvar_scvs, clinvar_vcvs, var-scv-change, ...), but they are not published [M: files exist; I: not public].
- **VCV/RCV dates missing:** the VCV/RCV statement JSON (I read VCV000000010.141-G-PATH) carries no date last
  evaluated, last updated or created. Only SCVs have dates [M].
- **Star rating** not materialized (derive from review-status text) [M/D].
- **Allele origin** (germline / somatic / de novo / maternal ...), affected status, number of observations and
  case data are not present [M: not in SCV columns/extensions; D: roadmap #104 "capture case data"].
  Functional-data submissions are also absent (roadmap #105).
- **Conflicts:** available at aggregate level (classification name + conflictingExplanation text). Pairwise
  submitter-vs-submitter conflict analysis (ClinVar Miner's core) must be computed from SCVs grouped by
  variant + condition, which needs the scv x proposition join (multi-GB) [I].
- **Submitter metadata** beyond name (country, org type) not present [M: only id/type/name/data].
- No variant-to-statement denormalization and no sort keys (see section 2), so every "by variant / gene /
  condition / submitter" page is a multi-GB join unless precomputed [M/I].
- Molecular consequence lives in nested HGVS structs. Gene, condition and submitter facets require joins
  through propositions [M].

---

## 5. Local / upstream repo pointers
- `~/dev/clinvar-gkm` (stale local; upstream main 2026-10-23 is current): pipeline = BigQuery stored
  procedures (`src/procedures/gkm-*-proc.sql`) over clinvar-ingest datasets -> `gkm_dict_*` tables ->
  `src/scripts/export-gkm-dicts.sh` (`EXPORT DATA` Parquet + NDJSON) -> local DuckDB merge (SNAPPY, unsorted)
  -> R2 upload. Typed Parquet column SQL: `src/scripts/parquet-schemas/*.sql`. Upstream added
  `release-gkm-parquet.sh`, `upload-gkm-parquet-to-r2.sh`, `r2-cors.json`, `cf-rules.sh` (cache rules: parquet
  edge 1 day, purged per rebuild), `cdn-kill-switch.sh`, `sub-bundle.py` (pulls a self-contained JSON bundle for
  a list of SCV/VCV/RCV ids from BigQuery, potentially useful for per-variant JSON pages).
- Upstream docs worth reading: `docs/parquet/performance.md` (remote vs local, materialize recipe),
  `docs/parquet/tables.md`, `docs/parquet/joining.md`, `docs/superpowers/plans/2026-10-17-variant-sorted-parquet.md`
  (lookup files), `docs/superpowers/plans/2026-10-16-parquet-followups.md` (D1 rate limit, C1-C4),
  `docs/decisions/0005-r2-custom-domain-and-cdn.md`, `0008`, `0009`, `docs/reference/roadmap.md`.
- `~/dev/clinvar-gk-python`: VRS normalization of ClinVar variants (weekly "noliftover" runs).
- `~/dev/gkm-starter-kit`: `ga4gh.gkm` Python package + vignettes for loading GKM bundles.
- `~/dev/clinvar-ingest`: XML -> BigQuery ingest. `~/dev/clinvar-ingest-bq-tools`: BigQuery JS UDFs + temporal
  /tracker procedures (history tables).

## 6. Implications (inference) [I]
1. Pure browser DuckDB-WASM against the published files works for footers, small tables (condition, gene,
   submitter, therapy, the somatic propositions, conditionSet) and the occasional single-column aggregate. It is
   **not viable for interactive per-variant, per-gene, per-condition or per-submitter pages**: tens to
   hundreds of origin range requests per page, 25-430 MB, and seconds to minutes with unpredictable stalls,
   all against a 250/10 s per-IP limit and the maintainers' explicit "not a query endpoint" policy and
   cost kill switch.
2. The published files would need re-shaping (pre-joined, key-sorted, <512 MB so they are edge-cacheable,
   ideally ZSTD), either upstream (C1 plan) or by us, before browser-side range querying is reasonable.
   Upstream has not shipped C1; it is "design only".
3. A server or build step that downloads the 13.2 GB set weekly (about 4 min at 68 MB/s) and materializes
   denormalized, indexed tables (DuckDB/Postgres, or derived sorted Parquet hosted on our own bucket) fits the
   data's shape and weekly cadence. A desktop/local mode is feasible, given that the docs show local queries in
   ms-s after a one-time download, but it means a 13 GB download (or our smaller derived set).
4. Weekly in-place overwrite of `parquet/` with no dated copies means a browser client cannot pin a release.
   A session spanning a rebuild could mix footer and data from different versions (the ETag changes). We would
   need our own immutable, dated derived files for reproducibility and history.
5. History features (classification change over time) require replaying JSON deltas from 2026-07 onward, or
   access to the upstream BigQuery temporal tables. Pre-2026-07 history is not published.
