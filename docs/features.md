# ClinVar GKM browser: features

Status: draft, 24 October 2026. What ClinVar Miner offered, what NCBI's ClinVar site doesn't do, and what we build in what order. Sources, URLs and code references are in [research/clinvar-miner-and-landscape.md](research/clinvar-miner-and-landscape.md). The data each feature needs is in [data.md](data.md).

## ClinVar Miner inventory

ClinVar Miner (Eilbeck Lab, University of Utah; Flask, SQLite, about 54 routes) organised everything as a pivot. Each page starts from a count by gene, condition, submitter or classification, drills down to a variant list, and ends at a variant's submissions. Filters carry through every drill-down link.

| Area | ClinVar Miner | Ours |
| --- | --- | --- |
| **By classification** | Terms with variant, gene, condition and submitter counts; drill-down by each | M2 |
| **By gene** | Gene list (multi-select); gene page with condition × classification and submitter × classification; drill-down to variant lists per submitter or condition | M2. Genes by NCBI gene ID, not symbol |
| **By condition** | Condition names; condition page with gene × classification and submitter × classification | M2, keyed by MedGen ID |
| **By MONDO term** | Rolls up all ClinVar conditions under a MONDO term, including ancestors | M2. Needs the MONDO hierarchy loaded during derivation |
| **By submitter** | Submitter profile (country, main collection method) with gene × classification and condition × classification | M2. Country needs `organization_summary.txt` (see [data.md](data.md#whats-missing-for-our-purposes)) |
| **Variant page** | All SCVs: submitter, RCV, SCV, classification, condition, last evaluated, review status, method, comment; links to NCBI | M1, with aggregate classifications per lane and the GA4GH record |
| **Conflict overview** | Variants with one submission, several but no conflict, each conflict level 1–5, any conflict | M2 |
| **Conflicts by classification** | Classification × classification matrix, cells coloured by conflict level; drill-down to variants with a given pair | M2 |
| **Conflicts by gene / condition** | Per-entity counts by level; per-entity matrix and variant list; condition-to-condition summary | M2 |
| **Conflicts by submitter** | Scorecard per submitter; one submitter against all others, with a table of every other lab and its conflict counts against this one | M2. The most-used feature by labs |
| **Submitter vs submitter** | Head-to-head: overview, term × term matrix, variants they disagree on, drill-down to "lab 1 said X, lab 2 said Y" | M2 |
| **Trends** | Submissions by collection method; by country (map); every classification term in use | M2 for current counts. Trends over time need history (M5) |
| **Filters** | Minimum stars and collection method for each side of a comparison; minimum conflict level; count conflicts across different conditions; gene type and antisense merging; classification as submitted vs normalized; release; multi-select of submitters, genes or conditions | M2. Multi-select goes in the query spec, not in very long URLs |
| **Search** | Exact-match redirects (rsID/RCV/SCV, gene, HGVS, condition, MONDO, submitter), then a Google site search | M1, with ranked results by type and prefix matching |
| **Download** | Client-side "table to CSV" of the rendered table, with buggy quote escaping | M3: streamed server-side export of the whole list, not just the visible page |
| **Release selector** | On every page, but only the latest release was kept after 2024 | M1 stamps the release; selecting old releases depends on how many we keep ([data.md](data.md#releases)) |

**Leave out or rethink:**
- The gene "type" filter and antisense merging: check whether users relied on them before rebuilding.
- The country choropleth: low value for the effort. A table is enough.
- Very long multi-select URLs: keep selections short, or as a saved query once accounts exist.

## What NCBI's site doesn't do

As of October 2026, from NCBI's documentation and the April 2026 relaunch:

- **Results are variants (VCVs), not submissions.** NCBI's own help notes that `genedx[Submitter] AND pathogenic` doesn't mean GeneDx said pathogenic.
- **No facets** for submitter, date last evaluated or flagged status; these are advanced-search fields only. The relaunch added a "types of conflict" facet.
- **No version history table** on VCV pages. Past versions are fetched one at a time by versioned accession.
- **Alerts** ("Follow") cover only aggregate germline changes for individual variants.
- **Submitter pages** show counts only.
- **Export** is tabular text or a list of IDs; no filtered bulk export with release provenance.
- **Archives:** new-format XML only from 2024; weekly files not kept.

## Build order

Decided 25 October 2026: those workflows come first, built on the general API in [api.md](api.md) rather than as one-off pages. Every list in the app is the same **explorer**: a filter bar, a table, a summary panel and export, over SCVs, variants or SCV pairs. Every entity page is a header plus explorer views with filters preset. Each of those workflows, and most new features, is a preset, so the core is built once.

Each phase is usable on its own. Effort is relative.

### Phase 0: foundation

Needed before anything else is useful. **Status, 25 October 2026:** done except 0.3 (data is still loaded with the scripts).

| # | Item | Notes |
| --- | --- | --- |
| 0.1 | **Classification vocabulary** | Derived table mapping each submitted classification term to a normalized code, a bucket (P, V, B, other, not provided) and a conflict rank. Blocks every pivot and conflict view. Rules need curator input ([api.md](api.md#open-questions)) |
| 0.2 | **Server skeleton** | gencc template: Fastify, Zod contracts, OpenAPI, errors, config, logging; DuckDB views over the newest release; the `QuerySpec` compiler with its first filters |
| 0.3 | **Data management** | First-run download, derivation with progress, release status, all in the app. In local mode nothing works without data |
| 0.4 | **Web shell** | gencc template: frame, navigation, theme, release stamp, URL-as-state helpers |

### Phase 1: look things up

**Status, 25 October 2026:** 1.1 and 1.2 done (variant page, search box and results); the SCV page is done, the SQL console isn't. Gene, submitter and condition pages exist in a first form (counts and a paged SCV list) ahead of phase 2.

| # | Item | ClinVar Miner equivalent |
| --- | --- | --- |
| 1.1 | **Variant page:** aggregate calls per classification type with review status and stars; all SCVs (submitter, classification, condition, date last evaluated, review status, method, comment); pairwise conflict levels; HGVS (MANE first), VRS, rsID, ClinGen CA; links to NCBI, ClinGen and gnomAD | `/submissions-by-variant` |
| 1.2 | **Search box:** accessions, variation IDs, rsIDs, gene symbols, condition and submitter names (prefix), exact HGVS. Direct lookups, without the deferred term table ([search.md](search.md)) | `/search` |
| 1.3 | **SCV page** (one submission, all fields) and **SQL console**, first version | none |

### Phase 2: ClinVar Miner's browse views

| # | Item | ClinVar Miner equivalent |
| --- | --- | --- |
| 2.1 | **The explorer:** filter bar for every [API filter](api.md#filters), sortable paged table, summary panel (counts by bucket), drill-down from any count to its rows, shareable URL. Over SCVs and variants | the drill-down variant lists, everywhere; plus SCV-level faceting, which neither ClinVar Miner nor NCBI has |
| 2.2 | **Gene, condition and submitter pages:** header plus crosstabs (condition × classification and submitter × classification on a gene page, and so on) and explorer drill-downs | `/variants-by-gene/<gene>`, `-by-condition/<c>`, `-by-submitter/<s>` and their sub-pages |
| 2.3 | **Index pages:** all genes, conditions, submitters and classification terms, with counts, sortable, multi-select into the explorer | `/variants-by-gene`, `-by-condition`, `-by-submitter`, `-by-significance` |
| 2.4 | **Classification term pages** | `/variants-by-significance/<sig>` |

### Phase 3: conflicts

| # | Item | ClinVar Miner equivalent |
| --- | --- | --- |
| 3.1 | **Conflict overview:** variants by maximum conflict level, with the same-condition and minimum-stars options | the overview row on every conflict page |
| 3.2 | **Term × term matrix,** global and per gene, condition or submitter, cells drilling down to the variant pairs | `/variants-in-conflict-by-significance[/<s1>/<s2>]` |
| 3.3 | **Conflicts by gene and by condition** | `/variants-in-conflict-by-gene`, `-by-condition` |
| 3.4 | **One submitter vs all others:** a scorecard, and a table of every other lab with conflict counts against this one | `/variants-in-conflict-by-submitter/<id>` |
| 3.5 | **Submitter vs submitter:** head-to-head matrix and the variants they disagree on | `/variants-in-conflict-by-submitter/<id1>/<id2>[/<s1>/<s2>]` |

### Phase 4: take data out, bring data in

| # | Item | Notes |
| --- | --- | --- |
| 4.1 | **Export** from every table and summary: TSV, CSV, NDJSON, parquet; release in the filename | ClinVar Miner's only export was a client-side CSV of the visible table |
| 4.2 | **API documentation page** and stable `v1` | |
| 4.3 | **SQL console,** full version: schema browser, saved queries, examples | local only |
| 4.4 | **Private variant lists:** VCF and identifier uploads, matched through the alleles' VCF keys; a `list` filter everywhere | local only |

### Phase 5: releases over time

| # | Item | Notes |
| --- | --- | --- |
| 5.1 | **Weekly updates:** in-app update check, download, derivation, switch | M4 in [plan.md](plan.md#milestones-proposed) |
| 5.2 | **Release selector:** any page against an older release still on disk | ClinVar Miner's `date` parameter, before it dropped history |
| 5.3 | **History and diffs** | Trial feature 1 below; needs a history design (interval tables or DuckLake snapshots) and data accumulated over releases |

### Left out, or needing outside data

| ClinVar Miner feature | Status |
| --- | --- |
| Variants by MONDO term (rollups over the MONDO hierarchy) | Needs the MONDO ontology, not in ClinVar-GKM. After phase 3, as a new external source. Prior work on fetching and reading MONDO: github.com/theferrit32/claude-gencc-demo |
| Submitter country and the country map | Needs NCBI's `organization_summary.txt`. A country column, low priority; no map |
| gnomAD allele frequency on the variant page | Needs gnomAD. Link out instead |
| Gene type filter and antisense-gene merging | Check with users before rebuilding |
| Total submissions by collection method, and classification terms in use | Become explorer summaries (group by `method`, by `classification`) in phase 2 |

## Trial features (phase 6 onward)

Candidates for M5–M6 and for showing to NCBI. Ordered by our current guess at value; to be reordered with users.

1. **Release history and diffs.** Per-variant and per-SCV timelines; "what changed between release A and B" for a gene, submitter, condition or saved query; transition matrices (e.g. VUS → likely pathogenic by lab, by gene); "as of date" views for citations. Today this exists only as raw deltas, internal BigQuery tables, Genome Alert!, and a few hobby repos from October 2026.
2. **Submitter benchmarking:** concordance with ClinGen expert panel (VCEP) classifications; outlier rate (how often a lab is the lone dissenter); share of classifications not re-evaluated in N years; how quickly a lab updates after an expert panel classifies the variant; flag rate.
3. **Conflict lifecycle:** when a conflict started, which side changed, how long it took to resolve. Conflicts open longest in a gene, for VCEP triage.
4. **Stale classification finder:** SCVs whose date last evaluated is old while newer evidence exists (other labs reclassified, an expert panel classified, or the condition's mapping changed).
5. **Somatic views:** oncogenicity and clinical impact facets, AMP/ASCO/CAP tiers, therapies.
6. **Trend dashboards:** submissions by method, lane, review status and classification over time.
7. **Bulk export in more formats:** GA4GH JSON (VA-Spec statements), parquet, VCF for variant lists.

## Later

- **Watchlists:** show what changed at SCV level for a saved query since the last visit (a submitter reclassifies a variant in my gene list). Locally this needs no accounts, since state lives in the user's workspace. Hosted, it needs accounts and email or feed delivery; gencc's portal phase will choose an authentication library we can reuse.
- **Annotations and discussion** on variants or conflicts. Only if a curation group asks for it; ClinVar and ClinGen already have channels for this.
- **Embedding and deep links from other tools** (ClinGen curation interfaces, the Allele Registry).

## Open questions

1. Which of ClinVar Miner's filters did users actually use? Server logs aren't available, but ClinGen staff and lab curators can tell us. Worth a short survey before M2.
2. Should the default classification scale normalize ClinVar's free-text and legacy terms (as ClinVar Miner did), and how should VUS sub-tiers display?
3. Where does the six-level conflict scale differ from NCBI's own conflict call, and do we show both?
4. Is VCEP concordance (trial feature 2) possible from ClinVar-GKM alone? Expert panel SCVs are identifiable by review status, but the ClinGen Evidence Repository has more detail.
