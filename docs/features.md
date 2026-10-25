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

**Decided 25 October 2026: support the workflows curators use.** What curators do with existing tools (see the inventory above, and how ClinGen taught one in [research/clinvar-miner-video.md](research/clinvar-miner-video.md)) must be achievable here in an intuitive way. The pages are organized so they extend as features are added. The variant, gene, condition, submitter and SCV pages are the frame; Those workflows become tabs, presets and explorer queries within it.

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

### What curators did with ClinVar Miner

From running the current fork on real data ([research/clinvar-miner-running.md](research/clinvar-miner-running.md), screenshots in [research/clinvar-miner-shots/](research/clinvar-miner-shots/)) and ClinGen's training video ([research/clinvar-miner-video.md](research/clinvar-miner-video.md): Steven Harrison, SVI co-chair, February 2019). The workflows, roughly by how much the video dwells on them:

1. **Review one lab's classifications against everyone else's.** The lab's conflict scorecard; its term × term grid against all others; a table ranking every other lab by disagreement at each level; one click to head-to-head with one lab, another to the variants in a grid cell.
2. **Compare against expert panels.** The same with the other side limited to expert panels and practice guidelines (Labcorp vs the ClinGen PAH panel: 173 variants), or an expert panel against starred labs to find outdated calls.
3. **Audit a lab against itself:** conflicts between one lab's own SCVs, some intentional (different conditions).
4. **Survey a gene:** classification mix; who submits (to recruit labs for an expert panel, reading each lab's classification mix to tell diagnostic labs from VUS-only ones); its conflicts as a term × term grid with clickable cells.
5. **Narrow to a work list:** stack filters (one star or more, clinical testing on both sides, clinically significant conflicts only; RYR1 went from 2,106 variants to 27), then download it to annotate outside the tool.
6. **Prefer gene over condition,** because one disease is scattered over many condition names ("not provided", "PAH-related disorder", ...); MONDO roll-ups help where conditions are used.
7. **Compare genes by rates,** e.g. the share of multi-submitter variants in conflict ("BRCA1 only 3% … BTD 42%"). ClinVar Miner didn't compute these; Harrison worked them out by hand for his slides.

### Where we differ from ClinVar Miner

Observed in the running fork:
- **Germline and somatic are mixed:** somatic "Tier I" against germline "Pathogenic" counted as a synonymous conflict (KRAS G12D, 256 pairs). Here, conflicts are only within one conflict-detectable classification type ([data.md](data.md#conflicts)).
- **Flagged submissions count toward conflicts;** ClinVar excludes them. Here, excluded by default (open question 5).
- **"not provided" and "not specified" match no other condition** (both map to the MONDO root), so with same-condition matching, the default, they're never compared: HFE H63D's 19 such SCVs sit apart from its 38 under hemochromatosis (open question 6).
- **Conflict lists show only HGVS, dbSNP and gnomAD frequency;** you can't see who said what without opening each variant. Here, a conflict list shows the two (or more) SCVs side by side.
- **Large CNVs become gene-combination rows,** making the gene index 245,810 px tall. Here, gene relationships are chosen explicitly (done, 25 October 2026).
- **Exact-string condition matching,** **no aggregate classification,** **no pagination,** **no API,** **export of the rendered table only,** and **history dropped for size.**

### Layout

Organized around entity pages:

- **Entity pages with tabs.** Variant, gene, condition, submitter (and SCV): an overview tab, then Submissions, Conflicts, and later History. Every tab is a set of explorer queries with the entity fixed, so filters work the same everywhere.
- **The explorer** for anything else: the full filter bar over SCVs, variants or SCV pairs, with a table, a summary and export. Index pages and common curator workflows are **presets**: named, linkable filter sets ("this lab vs expert panels", "clinically significant conflicts, clinical testing, one star or more").
- **Both sides of a comparison are filtered separately,** labelled by what they are ("submissions from Labcorp", "other submissions"), as ClinVar Miner's controls were.
- **Counts come with rates:** every count of variants or conflicts can show its share (of the gene's variants, of its multi-submitter variants), so comparisons across genes or labs need no arithmetic.
- **Explanations next to the numbers:** what each conflict level means, with examples; why rows of a breakdown don't add up to the total (a variant counts under each term it has).

### Phase 2: conflicts, then browse

Conflict comparison by lab was ClinVar Miner's most used feature, so it comes first.

| # | Item | Workflow | ClinVar Miner equivalent |
| --- | --- | --- | --- |
| 2.1 | **`/scv-pairs` and `/scv-pairs/summary`** in the API: pairs of SCVs on one variant and conflict-detectable type, with conflict level, same-condition matching, separate `a.`/`b.` filters, and dimensions over both sides ([api.md](api.md#scv-pairs-and-conflicts)) | all conflict views | the `comparisons` table |
| 2.2 | **Submitter page, Conflicts tab:** scorecard by level (counts and shares), term × term grid against all others, and the table of other labs ranked by disagreement. Side filters (stars, method), minimum level, same-condition toggle | 1, 2, 3 | `/variants-in-conflict-by-submitter/<id>` |
| 2.3 | **Head-to-head:** two submitters, their grid, and the variants they disagree on with **both labs' SCVs side by side** (classification, date, condition, comment) | 1, 2 | `/variants-in-conflict-by-submitter/<id1>/<id2>[/<s1>/<s2>]` |
| 2.4 | **Gene and condition pages, Conflicts tab:** conflict overview by level, grid, conflicting variants with their SCVs | 4 | `/variants-in-conflict-by-gene/<gene>`, `-by-condition/<c>` |
| 2.5 | **The explorer,** with presets for the workflows above and for ClinVar Miner's views | 5 | the drill-down lists, everywhere; plus SCV-level faceting |
| 2.6 | **Gene, condition and submitter overview tabs:** crosstabs (submitter × classification, condition × classification, gene × classification) with shares, and drill-down | 4 | `/variants-by-gene/<gene>` and the like |
| 2.7 | **Index pages:** genes, conditions, submitters, terms, with counts, shares and conflict rates, sortable, searchable | 4, 7 | `/variants-by-gene` and the like |
| 2.8 | **Comparison across entities:** rates for several genes or labs side by side | 7 | none; done by hand |
| 2.9 | **Per-table search** and **downloads** of any table | 5 | "Search this table", "Download table as spreadsheet" |

### Phase 3: conditions

| # | Item | Notes |
| --- | --- | --- |
| 3.1 | **MONDO roll-up:** conditions under a MONDO term, ancestors included, with counts | Needs the MONDO ontology (an outside source; see [Left out](#left-out-or-needing-outside-data)) |
| 3.2 | **Condition-to-condition table:** how one disease is split across condition names | From `scv_condition` and MONDO |

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
5. **Flagged submissions in conflicts.** ClinVar excludes them from its aggregate; ClinVar Miner counted them (59 flagged SCVs in 911 clinically significant pairs in the sample). Proposed: excluded by default, with a toggle.
6. **"not provided" and "not specified" with same-condition matching.** ClinVar Miner never compares them with named conditions, undercounting conflicts. Options: compare them with every condition (a wildcard), or make cross-condition comparison the default, as ClinVar's own aggregate does. Proposed: wildcard, so same-condition stays the default and these SCVs still count.

