# ClinVar Miner: code inventory, history, landscape, and gap analysis

Prepared 2026-10-24 for the ClinVar-GKM browser project.

Labels used below:
- **[code]**: verified by reading `~/dev/clinvar-miner` (git HEAD `eb7da45`, 2024-02-15).
- **[src]**: verified from a cited web source.
- **[inf]**: my inference or judgement.

Corrections to the brief: (1) ClinVar Miner came from the **Eilbeck Lab** (Karen Eilbeck, University of Utah Dept. of Biomedical Informatics), not the Hunter lab. The developer was Alex Henrie, funded through ClinGen grants U41 HG006834 (Rehm) and U01 HG007437 (Berg) [code: `templates/index.html`]. The upstream repo is `github.com/eilbecklab/clinvar-miner`, licensed GPL-3.0. (2) It is not fully shut down: its data froze at 2025-06-30, and a personal fork revived it in 2026 on clinvarminer.org. See section 1.9 and Part 2. (3) The local clone is stale (2024-02); upstream and the fork have 2026 commits.

---

## Part 1: What the code shows

### 1.1 Tech stack [code]

| Layer | What it used |
|---|---|
| Language | Python 3 |
| Web framework | Flask app in a single file (`clinvar-miner.py`, about 1,700 lines), served through Apache mod_wsgi (`clinvar-miner.wsgi`) |
| Templates | Jinja2, 40 page templates plus about 15 includes. Every page is rendered on the server. |
| Database | One **SQLite** file (`clinvar.db`), queried through a hand-written query builder in `db.py` (about 1,400 lines). No ORM. |
| Concurrency | `asynchelper.promise` runs each DB call in its own `ThreadPoolExecutor(1)`, so the several aggregate queries a page needs run in parallel. Each call opens a new SQLite connection. |
| Caching | `cachelib.FileSystemCache('/tmp/clinvar-miner')`, keyed by the full request URL. It stores gzipped responses with ETag/304 support, is cleared on every server restart, and by default never expires. |
| Front end | jQuery 3.1.1, jquery.tablesorter for client-side sorting, D3 v4 for one choropleth map and line graphs (since removed), Bootstrap 3 CSS. A table "search box" is a client-side substring filter on the first column. |
| Analytics | StatCounter |
| Python dependencies | cachelib, flask, html5lib (scraping NCBI submitter pages), psutil, pycountry, tqdm |
| CI | CircleCI, Python 3.6, runs `make latest && make test`. The only tests are Mondo unit tests in `mondo_test.py`. |
| Ops | Monthly manual rebuild (`make countries`, hand-check `submitter_info.tsv`, `make`), then restart httpd. The README says a build takes about 1 hour. Apache was configured with `Timeout 300` and `LimitRequestLine 1000000`, which points to slow pages and very long GET URLs. |
| Activity (local clone, through 2024-02) | 579 commits: 13 in 2016, 403 in 2017, 53 in 2018, 45 in 2019, 29 in 2020, 23 in 2021, 7 in 2022, 6 in 2024. Essentially one developer. |

### 1.2 Ingestion [code]

- **Source file.** The importer read only the **old-format RCV XML**, `ClinVarFullRelease_YYYY-MM.xml.gz`. The final code downloads it from `pub/clinvar/xml/RCV_xml_old_format/` (path changed 2024-02-14, commit `3a5ea7d`). It also downloaded `tab_delimited/organization_summary.txt` and scraped NCBI submitter pages (`get-submitter-info.py`) to get each submitter's **country**, kept in a hand-curated `submitter_info.tsv` (about 2,800 orgs). It downloaded `mondo.owl` for condition normalization.
- **How it parsed.** The whole uncompressed XML is `mmap`ed. A regex (`re.findall(b'<ClinVarSet .+?</ClinVarSet>')`) pulls **every** ClinVarSet into an in-memory list. Each set is parsed with ElementTree in a `multiprocessing.Pool`, but only if free RAM is at least twice the file size; otherwise it runs serially. All rows are bulk-inserted in one transaction.
- **Fields kept per SCV.** One denormalized row per SCV per release:
  - release date, variation ID, preferred variant name (HGVS), rsID, gnomAD allele frequency (added 2022)
  - gene symbol(s) and gene type: 0 = intergenic, 1 = single gene, 2 = multiple genes because close or overlapping, 3 = multiple genes because large. There is also a normalized gene with the `-AS1` antisense suffix stripped.
  - submitter ID, name and country
  - RCV and SCV as integers
  - significance as submitted, plus a normalized significance mapped through `nonstandard_significance_terms.tsv` (e.g. "vus" to "uncertain significance", "non-pathogenic" to "benign")
  - date last evaluated, review status, a derived star level (0, 1, 3 or 4; 2-star was removed)
  - condition name, condition xrefs (MedGen, OMIM, Orphanet, HPO, SNOMED, MeSH, UniProt, EFO, plus Mondo matches), and a "primary Mondo xref" (lowest common ancestor of the Mondo matches)
  - collection method, and a normalized method (clinical testing / curation / literature only / research / other)
  - submitter comment
- **Mondo normalization.** Mondo IDs are attached by xref and name matching. Within a variant, descendant Mondo IDs are replaced by ancestors that other submissions on the same variant used, so the conditions become comparable. A `mondo_clinvar_relationships` table maps every Mondo term, including all ancestors, to ClinVar condition names. This powers "Variants by Mondo condition", which rolls ClinVar conditions up the Mondo hierarchy.
- **The `comparisons` table, the core of the design.** For every release it builds a **self-join of every SCV with every other SCV on the same variant name**, including each SCV paired with itself. Each pair gets a 6-level `conflict_level`:
  - -1 = same SCV
  - 0 = no conflict (identical term, or either side "not provided")
  - 1 = synonymous (different term, same normalized term)
  - 2 = confidence (B vs LB, or P vs LP)
  - 3 = (L)B vs VUS
  - 4 = category (non-ACMG term involved, e.g. "risk factor" vs "benign")
  - 5 = clinically significant: (L)B or VUS vs (L)P

  `normalized_conflict_level` is set only when both SCVs share a primary Mondo condition, so by default conflicts are counted only within the same condition. A checkbox, "Report conflict between different conditions", switches to the raw level. **Almost every page queries `comparisons`, not `submissions`.** Single-submission views use the `conflict_level=-1` self-pairs.
- **History retention.** This changed over time:
  - 2016 to 2022: imported every monthly release since 2012. The importer also had an "only December of past years plus every month of this year" mode.
  - 2022-07 (commit `89fdfea`): pruned to December releases of past years plus the current year.
  - **2024-02-15 (commit `abdab8a`): pruned to the latest release only.** The over-time graphs ("submissions by method over time", "number of distinct significance terms over time") and the "old terms first seen / last seen" table were removed the same day.
- **Indexes.** `create-indexes.py` builds about 20 single and composite indexes on `submissions` and **36 five-column composite indexes** on `comparisons`: (date, conflict_level or normalized_conflict_level, star_level1, star_level2, X) for 18 columns. It also builds `gene_links` tables for "see also" links between gene combinations and their individual genes.

### 1.3 Pages and URL structure [code]

All paths are relative to the app root. `<cond>` and `<gene>` are "super-escaped" path segments: `/` becomes `%252F` because WSGI decodes slashes. `<sig>` is a significance term. Integer IDs are ClinVar org IDs or Mondo numeric IDs.

**Home `/`.** Shows release date and counts, plus three panels:
- Data exploration
- Conflict exploration
- High-level trends

**A. Data exploration ("variants by X")**

| URL | What it shows |
|---|---|
| `/variants-by-significance` | Table of significance terms with variants, genes, conditions and submitters per term. Totals row. |
| `/variants-by-significance/<sig>` | Variants reported with that term, broken down by condition, gene and submitter |
| `/variants-by-gene` | All genes and gene combinations with variants, conditions and submitters. Checkbox column to select several genes and re-query. |
| `/variants-by-gene/<gene>` (also `intergenic`) | Significance overview, a **gene × significance** "see also" tagline, a **condition × significance** table, a **submitter × significance** table |
| `/variants-by-gene/<gene>/significance/<sig>` (or `/any`) | Variant list |
| `/variants-by-gene/<gene>/submitter/<id>[/<sig>]` | Variant list for one submitter in one gene |
| `/variants-by-gene/<gene>/condition/<cond>[/<sig>]` | Variant list for one condition in one gene |
| `/variants-by-condition` | All ClinVar condition names, multi-select |
| `/variants-by-condition/<cond>` | Overview, gene × significance, submitter × significance. Tagline links to MedGen, OMIM, Orphanet, HPO, Mondo and others. |
| `/variants-by-condition/<cond>/significance/<sig>`, `/gene/<gene>[/<sig>]`, `/submitter/<id>[/<sig>]` | Drill-down variant lists |
| `/variants-by-mondo-condition` | List of Mondo terms, including ancestors that have ClinVar data |
| `/variants-by-mondo-condition/<mondo_id>` and the same `/significance`, `/gene`, `/submitter` drill-downs | Rolls up all ClinVar condition names under the Mondo term. Tagline lists the "Included ClinVar conditions". |
| `/variants-by-submitter` | All submitters with variants, genes and conditions, multi-select |
| `/variants-by-submitter/<id>` | Submitter profile: country and primary collection method, significance overview, **gene × significance**, **condition × significance** |
| `/variants-by-submitter/<id>/significance/<sig>`, `/gene/<gene>[/<sig>]`, `/condition/<cond>[/<sig>]` | Drill-down variant lists |
| `/submissions-by-variant/<variant_name>` | **Variant page.** All SCVs: submitter, RCV, SCV, significance, condition, last evaluated, review status, method, comment. Tagline shows gnomAD AF and rsID. Links out to the NCBI VCV/RCV pages. |

**B. Conflict exploration ("variants in conflict by X")**

Every conflict page shows a **conflict overview row** with these columns:
- variants with one submission
- variants with multiple submissions but no conflict
- counts at levels 1 through 5
- "any conflict"

A note on the page explains that a variant can appear in several level columns.

| URL | What it shows |
|---|---|
| `/variants-in-conflict-by-significance` | **Significance × significance conflict matrix**: submitted term vs other submitted term, cells colored by conflict level |
| `/variants-in-conflict-by-significance/<sig1>/<sig2>` | Variants with that specific pair |
| `/variants-in-conflict-by-gene` | Per gene: total, potentially conflicting, counts per level, any conflict. Multi-select. |
| `/variants-in-conflict-by-gene/<gene>` | Overview, significance × significance matrix for the gene, conflicting variant list |
| `/variants-in-conflict-by-gene/<gene>/<sig1>/<sig2>` | Variants with that pair in the gene |
| `/variants-in-conflict-by-condition` | Per condition, with per-level counts |
| `/variants-in-conflict-by-condition/<cond>` | Matrix, **condition-to-condition summary**, variant list |
| `/variants-in-conflict-by-submitter` | **Per-submitter conflict scorecard**: variants, potential conflicts, per-level counts, any conflict |
| `/variants-in-conflict-by-submitter/<id>` | One submitter vs all others: overview, **submitter's term × others' term** matrix, a **"submitter to submitter summary" table** (every other lab with per-level conflict counts against this lab), conflicting variant list |
| `/variants-in-conflict-by-submitter/<id1>/<id2>` (`<id2>`=0 means any submitter) | **Head-to-head comparison of two submitters**: overview, term × term matrix, list of variants they disagree on |
| `/variants-in-conflict-by-submitter/<id1>/<id2>/<sig1>/<sig2>` | Variants where submitter 1 said `sig1` and submitter 2 said `sig2` |

**C. High-level trends**

| URL | What it shows |
|---|---|
| `/total-submissions-by-method` | Submissions per collection method as submitted. Earlier versions had a line graph over releases, removed 2024-02. |
| `/total-submissions-by-country` | D3 world choropleth on a log scale, plus a table |
| `/total-submissions-by-country/<ISO3>` | Submitters in that country with submission counts |
| `/significance-terms` | Every distinct significance term string in current SCVs, linked to the variant list. Earlier versions also had a graph of distinct term count over time and a table of retired terms with first and last seen dates. |

**D. Search `/search?q=`.** A redirect-based resolver that tries these in order:
1. rsID, RCV or SCV, which go to the variant page. If an rsID matches no single variant, it goes to the gene of that rsID.
2. gene symbol, or the word "intergenic"
3. exact HGVS / variant name
4. exact condition name
5. `MONDO:nnnnnnn`
6. exact submitter name
7. otherwise a **Google `site:` search**

It does not do fuzzy or partial matching, autocomplete, or coordinate or range search.

### 1.4 Filters (query parameters) [code]

These are shared across pages through `include/filter.html`. Each page shows only the filters that apply.

| Param | Meaning |
|---|---|
| `min_stars1`, `min_stars2` | Minimum review status of submission 1 and submission 2 (in conflict views, "this submitter's" SCV vs "the other" SCV): any, 1★, 3★, 4★ |
| `method1`, `method2` | Collection method of each side: clinical testing, curation, literature only, research, other |
| `min_conflict_level` | 0 (multiple submissions) through 5 (clinically significant). Conflict pages are restricted to level 2 and up in the UI. |
| `original_conflict_levels=1` | Count conflicts across different conditions (ignore Mondo condition matching) |
| `gene_type` | 1, 2 or 3 as above |
| `original_genes=1` | Don't merge antisense genes into their sense gene |
| `original_terms=1` | Show significance as submitted rather than normalized |
| `date=YYYY-MM-DD` | **ClinVar release selector.** It appears on every page. After the 2024 pruning only one value remained. |
| `submitters=`, `genes=`, `conditions=` (repeated) | Multi-select from checkbox columns on index tables, to restrict to a chosen subset. This is why the URLs were very long. |

`query_suffix()` carries the relevant filters forward on every drill-down link, so a filtered view stays filtered as you navigate. `robots.txt` blocks any URL with `?`.

### 1.5 Cross-tabulations [code]

- significance overview: variants per term, for a gene, condition, submitter or Mondo term
- gene × significance (within a submitter, condition or Mondo term)
- condition × significance (within a gene or submitter)
- submitter × significance (within a gene, condition, Mondo term or significance)
- significance × significance conflict matrix (global, per gene, per condition, per submitter vs all, per submitter pair)
- entity × conflict level (genes, conditions, submitters, and a submitter's opponents)
- condition × condition conflict summary (within a condition)
- country × submissions, and submitter × submissions within a country
- totals rows: number of variants, genes or gene combinations, conditions, submitters

### 1.6 Downloads [code]

- The **only** download is "Download table as spreadsheet". Client-side JavaScript (`downloadTableAsCsv` in `static/global.js`) serializes the visible HTML table to CSV. Its quote escaping is buggy: `replace('"','""')` replaces only the first quote.
- There was no server-side export, API, bulk dump or JSON endpoint. A list could be downloaded only after the entire table had rendered in HTML, and there was no pagination.

### 1.7 What it did not have [code]

- **No per-variant or per-SCV history**, even when many releases were loaded. The `date` selector was a time machine for the whole site, not a diff. No reclassification tracking, no "what changed this month" view.
- No VCV/RCV aggregate classification shown. Everything was SCV-level, and conflict status was its own pairwise calculation, not ClinVar's.
- No somatic or oncogenicity classifications. The code predates ClinVar's 2024 split.
- No genomic coordinates, HGVS normalization, consequence, variant type, or ClinGen allele IDs. Variant identity was the **preferred name string**.
- No user accounts, saved queries or alerts. No ranges, regions or gene panels.

### 1.8 Where the design would have hit scaling limits [code + inf]

1. **Pairwise `comparisons` table, quadratic per variant.**
   - Rows per release = Σ over variants of (SCVs on that variant)², including self-pairs. [code]
   - ClinVar has grown to roughly 3.5M+ SCVs, and many variants carry dozens of SCVs (BRCA1/2, CFTR, and common benign variants submitted by every lab). So this table is several times larger than `submissions`. Every row is a wide, denormalized copy of submission 1 plus part of submission 2. [inf]
   - With the 36 five-column composite indexes on top, the DB file and build time grow super-linearly. [inf]
   - Keeping many releases multiplies all of this by the number of releases. That is the most likely reason history was cut, first to Decembers in 2022 and then to the latest release only in 2024. [inf, strongly suggested by the commit sequence]
2. **Ingest held everything in memory.** It regex-split the whole uncompressed XML into a Python list, then held every parsed row before inserting. Parallel import needed free RAM of at least twice the uncompressed file. The old-format gzip was about 4.9 GB by mid-2025, which is tens of GB uncompressed. [code + src FTP listing; inf on uncompressed size]
3. **SQLite as a shared read/write store.**
   - The import holds one big write transaction. [code]
   - The web app opens a new connection per query thread and runs many `COUNT(DISTINCT …)` aggregates per page over the full table, with no materialized summaries. [code]
   - The `and_equals` list filter creates TEMP tables named after columns per request. [code]
4. **Compute-on-request plus URL cache.**
   - Index pages compute global aggregates live. [code]
   - The cache is cleared on restart, so after each monthly rebuild every expensive page is cold again. The 300 s Apache timeout suggests pages took minutes on cold cache. [code + inf]
   - Query-string combinations make the URL space effectively unbounded. [code]
5. **Unpaginated HTML tables.** Pages for big genes or submitters render every variant row so that client-side sort, filter and CSV export work. Browsers struggle with tens of thousands of rows. [code + inf]
6. **Identity by name string.**
   - Variants are joined on `variant_name`, not VariationID. [code]
   - Renamed variants break URLs and comparisons across releases. [inf]
   - Genotype and haplotype sets all get `variant_id=0`. [code]
   - Conditions are keyed by free-text name. [code]
7. **Hard dependency on one deprecated NCBI format.**
   - NCBI moved the old RCV XML to `RCV_xml_old_format/` in 2024. [src]
   - The last old-format file is `ClinVarFullRelease_2025-07.xml.gz`, and the FTP README says old formats are "no longer supported as of August 7, 2025". [src: https://ftp.ncbi.nlm.nih.gov/pub/clinvar/xml/_README and the directory listing, checked 2026-10-24]
   - The site's data froze at the 2025-06-30 release (see Part 2) until the fork ported the importer to the new RCV XML in June 2026. [code + src]
8. **Manual curation in the release loop.** Submitter countries were scraped and hand-checked every month. The Mondo OWL was re-downloaded each build, so Mondo mappings could drift between builds. [code]
9. **Bus factor of one.** Commit activity fell from 403 in 2017 to 6 in 2024. [code]

### 1.9 Local clone is stale; the project is not dead [src, verified via GitHub API 2026-10-24]

The local clone at `~/dev/clinvar-miner` stops at `eb7da45` (2024-02-15/16).

**Upstream `eilbecklab/clinvar-miner`** has 8 more commits:
- 2026-01: always import in parallel, new significance terms, "Ensure tables are created".
- 2026-03-16: "Update link to Eilbeck Lab website" and "Use the root directory in the Apache example".

**Active development moved to Alex Henrie's personal fork, [`alexhenrie/clinvar-miner`](https://github.com/alexhenrie/clinvar-miner/commits/master):**
- 2026-03-16: "Remove University of Utah, NCBI, and ClinGen logos".
- **2026-06-21: "Update to the new ClinVar XML format. And stop supporting the old format."** (`7887147`). It now reads `RCV_release/ClinVarRCVRelease_YYYY-MM.xml.gz`, and history imports start at 2024.
  - It flattens the new classification types into the same single `significance` column, taking `GermlineClassification`, else `SomaticClinicalImpact`, else `OncogenicityClassification`.
  - So somatic and oncogenicity terms get mixed into germline statistics and conflict levels instead of being modeled separately. [code from the GitHub diff]
- 2026-06-23: switch from gzip to zstd and make compression mandatory, remove StatCounter, hide the date selector when only one release is loaded.
- 2026-10-22: remove the "Significance terms" page; replace the Google site-search fallback with Brave search.
- 2026-10-24: query optimizations ("Include filters in database queries only when necessary").

**Hosting.** `https://clinvarminer.genetics.utah.edu/` now returns `301` to `https://www.clinvarminer.org/`. From this machine `www.clinvarminer.org` did not resolve; the research agent reports it has only an AAAA (IPv6) record. The domain was registered 2026-03-16. Wayback has captures of clinvarminer.org from 2026-06-11 to 2026-10-08, and a June 2026 capture showed "ClinVar version: 2025-06-30" as the only release.

**Net:** ClinVar Miner was effectively frozen from mid-2025 to mid-2026, and is now a single-person hobby continuation on a personal domain. It is architecturally the same app: SQLite, the `comparisons` self-join, latest release only. It has not been shut down outright. [src + inf]

---

## Part 2: The paper, the site's history, and how people used it

### 2.1 The paper [src]

**Citation.** Henrie A\*, Hemphill SE\*, Ruiz-Schultz N, Cushman B, DiStefano MT, Azzariti D, Harrison SM, Rehm HL, Eilbeck K. "ClinVar Miner: Demonstrating utility of a Web-based tool for viewing and filtering ClinVar data." *Hum Mutat* 2018;39(8):1051–1060.
- DOI [10.1002/humu.23555](https://doi.org/10.1002/humu.23555)
- PMID [29790234](https://pubmed.ncbi.nlm.nih.gov/29790234/)
- [PMC6043391](https://pmc.ncbi.nlm.nih.gov/articles/PMC6043391/)
- Europe PMC lists about 110 citing articles; about 71 full-text records mention "ClinVar Miner" ([query](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=%22ClinVar%20Miner%22&format=json&pageSize=100)).

**How it was built.**
- Requirements came from biweekly meetings with ClinGen staff: medical directors, genetic counselors, biocurators and bioinformaticians.
- Architecture as described in the paper: XML loaded into SQLite as a `submissions` table plus a self-joined `comparisons` table, Flask/WSGI, D3, caching.
- **The DB was 31.8 GiB in January 2018 and growing about 1.5 GiB per monthly release.** That was at roughly 581k SCVs; ClinVar now has about 7.4M.

**Three use cases ("11 tools").**
1. Gene and condition exploration for curation groups, such as finding top submitters in a gene to recruit expert panel members.
2. Conflict exploration for discrepancy resolution. This used the 5-level conflict taxonomy, filtered by review status and method.
3. High-level trends for ClinGen policy: submissions by method over time, a by-country choropleth, and significance terms over time. ClinGen also used the submitter-centric views to check labs' claims about how much data they shared.

**Statistics quoted (January 2018: 580,831 SCVs on 375,106 variants).**
- Clinically significant conflict rate: 2.28% between clinical testing labs; 3.62% for clinical testing vs curation; 15.4% for literature-only; 11.8% for research.
- 77% of genes with multiple submitters had no clinically significant conflict.
- 36% of genes had a single submitter.
- 109,902 variants had condition "not specified".

**Stated limitations.**
- It only re-views ClinVar data.
- Free-text condition names make condition-level aggregation hard, which later led to the Mondo pages.
- A conflict-lopsidedness metric was planned.
- The authors note that before ClinVar Miner, conflict analyses such as Harrison et al. 2017 needed custom reports from NCBI staff.

### 2.2 Documentation [src]

- There was no separate FAQ or About page. The home page with its three panels served as the documentation ([2019 snapshot](https://web.archive.org/web/20190715223239/https://clinvarminer.genetics.utah.edu/)).
- The README covers installation and the monthly rebuild only.
- The paper says the tool was demonstrated on NCBI's monthly ClinVar community call.
- I found no dedicated ASHG or ClinGen poster. The abstract archives were not searched exhaustively.

### 2.3 Wayback Machine timeline [src]

- **First captures.** The first capture of the host is from 2019-04. The first home page capture is [2019-07-15](https://web.archive.org/web/20190715223239/https://clinvarminer.genetics.utah.edu/): "820,809 submissions on 511,257 variants".
- **What got archived.** About 7,900 of the first 8,000 unique archived URLs are `submissions-by-variant/<HGVS>` pages. Search engines and crawlers mostly reached variant pages. [inf: those pages were the main external entry point]

**Data-currency banners on the home page:**

| Snapshot | Data as of | Submissions | Variants |
|---|---|---|---|
| 2024-04 | 31 March 2024 | 4,174,304 | 2,813,113 |
| 2025-04-01 | 5 March 2025 | 5,205,209 | 3,450,186 |
| 2025-12 and 2026-05 | **30 June 2025** (frozen) | 5,432,546 | 3,591,080 |

**Decline, as captured:**
- **Deprecation banner.** It first appears in the [2025-04-01 capture](https://web.archive.org/web/20250401033845/https://clinvarminer.genetics.utah.edu/) and was still there in 2026-05. The text: "The future of ClinVar Miner is uncertain, we're exploring ways to support ClinVar Miner's functionality through our partnership with ClinGen and ClinVar. If this site is valuable to you, please take a few minutes to fill out this brief survey…" The banner is not in the GitHub code. [inf: it was edited on the server]
- **Errors.** HTTP 500s were captured on 2025-05-26 and 2025-06-18.
- **Hostname misrouting.** On 2026-06-08 the utah.edu hostname served an unrelated Neo4j endpoint.
- **Redirect.** From 2026-07-02 the utah.edu host redirects (301) to clinvarminer.org. The domain was registered 2026-03-16, the same day the fork removed the Utah, NCBI and ClinGen logos.

**Release selector.** Papers cite specific ClinVar Miner releases (2019-05, 2019-12, 2021-05-01, 2022-2-28, 2022-12-31). So the release selector was used for **reproducible, dated snapshots**. That capability was removed in 2024.

### 2.4 Why it declined [src for facts, inf for the causal story]

These causes are inferred from the code history, the banners and NCBI format notices:

1. **Unfunded single maintainer.** The project was tied to ClinGen grants, and one developer wrote 578 of 587 commits.
2. **Storage and compute growth.** The pairwise schema grew far faster than ClinVar itself, from 31.8 GiB at 0.58M SCVs. History was cut to Decembers (2022), then to the latest release only (2024).
3. **The 2024 XML redesign.** Old formats were retired on 2025-08-07, after the last old-format RCV release (2025-07). Data froze at 2025-06-30 until the fork ported the importer in 2026-06. The port collapses germline, somatic and oncogenicity terms into one field.
4. **Institutional handoff.** The Utah host left the University of Utah, ending as a personal domain. No public announcement about the decline or the move was found.

### 2.5 What people used it for [src; full texts read by the research agent]

| Use | Example |
|---|---|
| Lab self-audit and conflict reports | ClinGen authors told labs they "can obtain reports of their variant interpretation differences from the ClinVar Miner website" (Azzariti et al., CSH Mol Case Stud 2018, [PMC6169822](https://pmc.ncbi.nlm.nih.gov/articles/PMC6169822/)) |
| Interlab concordance studies | Epilepsy genes, JAMA Netw Open 2020, using ClinVar Miner release 2019-05 ([PMC7191323](https://pmc.ncbi.nlm.nih.gov/articles/PMC7191323/)); All of Us harmonization, Hum Mutat 2022, release 2021-05-01 ([PMC9206690](https://pmc.ncbi.nlm.nih.gov/articles/PMC9206690/)) |
| Expert panel baselines and gene-disease validity | PAH VCEP, Hum Mutat 2018 ([PMC6556116](https://pmc.ncbi.nlm.nih.gov/articles/PMC6556116/)); hearing-loss gene validity, Genet Med 2019 ([PMC7280024](https://pmc.ncbi.nlm.nih.gov/articles/PMC7280024/)) |
| Extracting variant sets by gene, condition or significance for datasets and predictor benchmarks | Familial hypercholesterolemia (FH) genes ([PMC6206854](https://pmc.ncbi.nlm.nih.gov/articles/PMC6206854/)); reproductive genes, PNAS 2023 ([PMC10372637](https://pmc.ncbi.nlm.nih.gov/articles/PMC10372637/)); CACNA1D ([PMC11369236](https://pmc.ncbi.nlm.nih.gov/articles/PMC11369236/)); SLC transporters ([PMC6874521](https://pmc.ncbi.nlm.nih.gov/articles/PMC6874521/)) |
| Comparing specific submitters | ENIGMA vs ARUP vs German consortium for BRCA variants, IJMS 2020 ([PMC7312854](https://pmc.ncbi.nlm.nih.gov/articles/PMC7312854/)) |
| VUS and reclassification trends using dated releases | Preconception genes, PLoS One 2025 ([PMC12111534](https://pmc.ncbi.nlm.nih.gov/articles/PMC12111534/)); Simons Searchlight, GIM Open 2024 ([PMC11613566](https://pmc.ncbi.nlm.nih.gov/articles/PMC11613566/)) |
| Finding variants NCBI search didn't surface | SMARCB1, Cancer Genet 2025 ([PMC13180426](https://pmc.ncbi.nlm.nih.gov/articles/PMC13180426/)) |
| Cited as related work | Clinotator ([PMC5941247](https://pmc.ncbi.nlm.nih.gov/articles/PMC5941247/)); Simple ClinVar, NAR 2019 ([PMC6602488](https://pmc.ncbi.nlm.nih.gov/articles/PMC6602488/)); JoGo, NAR 2026 ([PMC12807767](https://pmc.ncbi.nlm.nih.gov/articles/PMC12807767/)) |

---

## Part 3: The landscape in 2026

Sources: the research agent read NCBI pages through Internet Archive snapshots because live NCBI pages were behind a CAPTCHA. I verified the FTP facts directly.

### 3.1 NCBI ClinVar: what it has

**Scale.** As of 2026-10-17: about 7.37M submissions, 4.68M variants, 3,563 submitters [src: homepage snapshot].

**Classification types** [src: [Landrum et al. NAR 2025;53:D1313](https://academic.oup.com/nar/article/53/D1/D1313/7907366); [clinsig doc](https://www.ncbi.nlm.nih.gov/clinvar/docs/clinsig/)]:
- Each SCV has one type: germline, somatic clinical impact (AMP/ASCO/CAP tiers), or oncogenicity (ClinGen/CGC/VICC).
- Germline aggregation: an expert panel or practice guideline wins. Conflicts are defined between the P/LP, VUS and LB/B groups (since 2022).
- Oncogenicity aggregation also reports conflicts.
- Somatic clinical impact takes the highest tier among the top review status, with no conflict calculation.
- **VUS sub-tiers (VUS-high, VUS-mid, VUS-low) were added in 2026-01** [src: [ncbi/clinvar schema commit](https://github.com/ncbi/clinvar), [FTP README](https://ftp.ncbi.nlm.nih.gov/pub/clinvar/README.txt)].

**VCV page** (redesigned 2024-01, functional-evidence section 2025-08) [src: [NCBI Insights 2024-01-31](https://ncbiinsights.ncbi.nlm.nih.gov/2024/01/31/enhancements-clinvar-website-live/), [variation_report doc](https://www.ncbi.nlm.nih.gov/clinvar/docs/variation_report/), [functional data post](https://ncbiinsights.ncbi.nlm.nih.gov/2025/08/18/improved-representation-functional-data-clinvar/)]:
- No tabs, with a germline/somatic toggle.
- Each SCV row shows "First in ClinVar" and "Last updated", and "Not contributing to aggregate classification" for flagged SCVs.
- Follow, Download and Cite buttons.
- **No version or history table in the documented sections.** Past versions are available only one at a time, through `VCV….N` search or efetch with a versioned accession [src: [help](https://www.ncbi.nlm.nih.gov/clinvar/docs/help/), [maintenance_use](https://www.ncbi.nlm.nih.gov/clinvar/docs/maintenance_use/)].

**Search** (relaunched 2026-04) [src: [NCBI Insights 2026-04-23](https://ncbiinsights.ncbi.nlm.nih.gov/2026/04/23/clinvars-new-search-homepage/)]:
- Search boxes: variant, gene, genomic location, disease, other.
- Facets: classification type, germline classification, **types of conflict** (P/LP vs LB/B, P/LP vs VUS, VUS vs LB/B), consequence, variation type, size, length, review status.
- Submitter, date last evaluated, created and modified dates are available only as Advanced-search fields.
- **Search returns VCVs, not SCVs.** NCBI's help says `genedx[Submitter] AND "clinsig pathogenic"[Properties]` finds VCVs that are pathogenic in aggregate and include *a* GeneDx SCV, "but not necessarily an SCV that GeneDx classified as pathogenic."

**Downloads** [src: [FAQ](https://www.ncbi.nlm.nih.gov/clinvar/docs/faq/)]:
- Results export only as tabular text or a UID list.
- "ClinVar does not currently support a batch query interface."
- Otherwise use the FTP files or E-utilities.

**Submitter pages:**
- Contact details, assertion criteria, total SCVs, and per-gene and per-condition counts.
- **No classification breakdown, concordance or conflict statistics** [src: e.g. [submitters/500031](https://www.ncbi.nlm.nih.gov/clinvar/submitters/500031/)].

**Flagging** [src: [curation doc](https://www.ncbi.nlm.nih.gov/clinvar/docs/curation/), [NCBI Insights 2023-09-20](https://ncbiinsights.ncbi.nlm.nih.gov/2023/09/20/clinvar-partners-with-clingen/)]:
- ClinGen curators propose flags monthly, for example outlier claims or conflicts with expert panels.
- The submitter has 60 days to respond, otherwise the SCV is flagged and excluded from the aggregate.
- Exact duplicates are auto-flagged.
- There is no aggregate view of flags.

**Alerts** [src: [alerts doc](https://www.ncbi.nlm.nih.gov/clinvar/docs/alerts/)]:
- "Follow" a VCV to get a weekly email **only when the aggregate germline classification changes**.
- My NCBI saved-search alerts are also available.
- There are no SCV-level, somatic, review-status, gene-level or submitter-level alerts.

**FTP** [src: verified directly 2026-10-24, [tab_delimited/](https://ftp.ncbi.nlm.nih.gov/pub/clinvar/tab_delimited/), [xml/_README](https://ftp.ncbi.nlm.nih.gov/pub/clinvar/xml/_README)]:
- **Release cadence.** Monthly releases come out on the first Thursday. Weekly releases come out on Mondays and are deleted at the next monthly release.
- **XML formats.** New-format VCV XML (about 6 GB gz) and RCV XML. Old formats were unsupported from 2025-08-07, and the new-format XML archive only starts in 2024.
- **Tab-delimited archives.** These go back to 2014 (year folders 2014 and 2016–2024 are present). They include `submission_summary.txt.gz` (current SCVs), `variant_summary`, `organization_summary`, and others.
- **`summary_of_conflicting_interpretations.txt` (about 2.06 GB) is NCBI's own pairwise SCV-vs-SCV table**, essentially ClinVar Miner's `comparisons` table. Columns:
  - `Gene_Symbol, NCBI_Variation_ID, ClinVar_Preferred`
  - `Submitter1, Submitter1_SCV, Submitter1_ClinSig, Submitter1_LastEval, Submitter1_ReviewStatus, Submitter1_Sub_Condition, Submitter1_Description`, and the same for `Submitter2`
  - `Rank_diff, Conflict_Reported, Variant_type, Submitter1_Method, Submitter2_Method`

  It is archived monthly. **No NCBI UI is built on it.**

**E-utilities and roadmap:**
- E-utilities provide esearch, esummary (JSON), elink, and efetch (VCV/RCV, including specific versions).
- NAR 2025 mentions possible future pharmacogenomic classifications and standardized cancer types and drugs.
- **No NCBI-announced plan to drop RCV or adopt GA4GH VRS/VA-Spec was found.** That work lives at ClinGen in ClinVar-GKM. [src: agent's search of NCBI Insights; absence of evidence only]

### 3.2 What NCBI does not support

- SCV-level querying, e.g. "variants where lab X said P and lab Y said B" [src: help doc example]
- Submitter-vs-submitter cross-tabs, concordance or scorecards [src: submitter page]
- Release-over-release diffs at SCV or VCV level, or an "as of date" view [src: VCV doc; FTP layout]
- Filtered bulk export in VCF, JSON or Parquet for an arbitrary query [src: FAQ]
- Facets for submitter, date last evaluated, flagged status, somatic tier or oncogenicity value [src: help, relaunch post]
- Flag analytics, stale-classification analytics (by date last evaluated), and trend dashboards [inf from the absence of any such feature in the docs]
- Watches on genes, queries or submitters, or at SCV level [src: alerts doc]

### 3.3 Other tools

| Tool | What it does | Gap relevant to us |
|---|---|---|
| **ClinVar-GKM / GKS** ([repo](https://github.com/clingen-data-model/clinvar-gkm), [docs](https://dataexchange.clinicalgenome.org/clinvar-gkm/)) | Whole-release VRS / Cat-VRS / VA-Spec statements for SCV, VCV and RCV. Monthly and weekly full bundles, **weekly delta files with add/update/delete manifests**, current Parquet on R2. Back-releases planned in `clinvar-gkm-parquet`. [src] | No UI. This is our data source. |
| **clinvar-ingest + clinvar-ingest-bq-tools** (ClinGen) ([docs](https://dataexchange.clinicalgenome.org/clinvar-ingest-bq-tools/sql-scripts/temporal-data-collection/)) | BigQuery relational ClinVar with **temporal tables** (start, end and deleted release) for SCVs, VCV classifications, submitters and others, plus "GC tracker" curation reports [src] | Internal or curation-facing. Public access unclear [src]. |
| **Google BigQuery public ClinVar** ([page](https://cloud.google.com/life-sciences/docs/resources/public-datasets/clinvar)) | Stale 2018 snapshot [src] | Effectively dead |
| **ClinGen ERepo** ([link](https://erepo.clinicalgenome.org/evrepo/)) | VCEP classifications with evidence, TSV download and an API [src] | Expert-panel variants only. A natural "truth set" for benchmarking submitters. |
| **ClinGen Allele Registry, Linked Data Hub, VCI** | Identity and curation infrastructure; the LDH UI is deprecated [src/inf] | Not ClinVar browsers |
| **UCSC ClinVar tracks** ([link](https://genome.ucsc.edu/cgi-bin/hgTrackUi?db=hg38&g=clinvar)) | SNV, CNV and per-submission "interp" tracks, filterable; past months archived as files [src] | Genome-position view only; no diffs or submitter analytics |
| **gnomAD ClinVar track** ([news](https://gnomad.broadinstitute.org/news/2021-02-clinvar-track-in-gnomad-filter/)) | ClinVar variants on gene and region pages, star filter [src, from search summary only] | Single snapshot, gene-centric |
| **VarSome, Franklin** | Per-variant aggregation; Franklin offers "follow" reanalysis [search summary / inf] | No submitter benchmarking or release diffs found |
| **Genome Alert!** ([site](https://genomealert.univ-grenoble-alpes.fr/), [preprint](https://www.medrxiv.org/content/10.1101/2021.07.13.21260422.full.pdf)) | Monthly ClinVar diffs, with about 1,247 clinically relevant changes per month in 2017–2019 [search summary] | Alerting for a uploaded variant list; not an analytics browser |
| **VariantAlert** ([about](https://variant-alert.crs4.it/about)) | Daily re-annotation via MyVariant.info with email alerts [search summary] | Same as above |
| **Clinotator** ([repo](https://github.com/rbutleriii/Clinotator)) | Ambiguity score per variant [src] | Narrow |
| **clinvar-history, clinvar-delta** (hobby repos, 2026-10, [github.com/Daneshpajouh](https://github.com/Daneshpajouh)) | DuckDB or Postgres store of releases, diffs between two releases [src] | Brand new, unproven; shows the demand |
| **varfish-org/clinvar-data-jsonl** ([repo](https://github.com/varfish-org/clinvar-data-jsonl)) | Weekly XML converted to JSONL [src] | Data only |
| **Commercial** (Fabric, Emedgene, VarSeq, Labcorp/Invitae notices) | Case-level reanalysis and alerts [inf, unverified] | Closed, case-oriented |
| **Reclassification studies** (e.g. Harrison & Rehm, Genome Med 2019, [PMC6873511](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6873511/); review at [doi:10.1136/jmg-2023-109488](https://doi.org/10.1136/jmg-2023-109488)) | One-off diff pipelines [search summary / inf] | No shared, public history service exists [inf] |
| **CIViC** | Richer somatic knowledgebase; one of the first somatic submitters to ClinVar [src NAR 2025] | Different scope |

---

## Part 4: Lessons and opportunities

### 4.1 Lessons from ClinVar Miner [inf, grounded in Part 1 and Part 2]

1. **The core idea worked.** Every view was a pivot of SCVs on {significance, gene, condition, submitter}, each with a parallel conflict view. Users clicked from aggregate counts down to variant lists, and filters persisted through every drill-down. Keep this interaction model.
2. **The 6-level conflict taxonomy and "conflicts within the same condition (Mondo-normalized)" were real contributions.** Both are more nuanced than ClinVar's three-group conflict facet. Note the overlap and the difference with NCBI's `Rank_diff` in the pairwise conflict file.
3. **Pairwise conflict data can be computed or downloaded, but it must not be the store every page query runs against.**
   - The quadratic `comparisons` table plus 36 wide indexes is why history was dropped.
   - Store SCVs once. Compute pairwise conflicts only for multi-SCV variants, in a narrow table of IDs and levels, or use NCBI's `summary_of_conflicting_interpretations`.
   - Precompute aggregates per release in a columnar engine such as DuckDB over Parquet.
4. **History was the feature users relied on, and the one that broke first.** Papers cite specific releases. Design for N releases from day one:
   - Use interval or temporal SCV tables (like clinvar-ingest-bq-tools) or ClinVar-GKM deltas, not full copies per release.
   - Every page and download should carry the release ID, so results can be cited reproducibly.
5. **Use stable identifiers.**
   - VariationID, VRS and Cat-VRS for variants. Not the preferred HGVS name.
   - Mondo or MedGen IDs for conditions. Not free text.
   - Keep real URLs for submitter, gene, condition and variant pages, like ClinVar Miner's REST-ish paths, which were easy to share and cite. Avoid huge GET query strings for multi-select.
6. **Downloads must be server-side and filtered.** Rendering a full table in HTML just to export a CSV client-side broke on big genes and submitters, and the escaping was buggy. Paginate the UI and stream exports.
7. **Model germline, somatic and oncogenicity separately.** The 2026 port merges them into one column, which pollutes conflict statistics. VUS sub-tiers (2026-01) need their own normalization.
8. **Avoid single-format and single-maintainer fragility.**
   - Pin the ingest to a maintained, documented product (ClinVar-GKM).
   - Automate the monthly or weekly refresh.
   - Do away with manual curation such as the submitter-country TSV; `organization_summary.txt` already has country information.
9. **Search needs to be real search.** ClinVar Miner used exact-match redirects, then fell back to Google or Brave site search. Add type-ahead over genes, submitters (including aliases) and conditions (with Mondo synonyms), plus HGVS and coordinate lookup.
10. **Show the counting semantics.** ClinVar Miner's notes explained how it counted, e.g. "a variant may be counted in more than one conflict column". That transparency matters for research citations.

### 4.2 Gap opportunities, ranked

1. **SCV-level query and faceting (top priority).**
   - Filter on what a specific submitter said, plus method, review status, date last evaluated, flagged status, classification type and condition.
   - NCBI cannot do this [src]. ClinVar Miner only did it through fixed pages.
2. **Release history and diffs (top priority).**
   - Per-variant and per-SCV timelines.
   - "What changed between release A and B" for a gene, submitter or condition.
   - Transition matrices (e.g. VUS→LP by gene or by lab).
   - As-of-date views for reproducibility.
   - Today this exists only as raw deltas (GKM), internal BigQuery tables, hobby scripts or one-off papers.
3. **Submitter pair conflicts and benchmarking.** Re-create and extend ClinVar Miner's head-to-head and "submitter vs everyone" views, adding:
   - concordance with ClinGen expert panels (ERepo)
   - outlier rate
   - flag rate and flag reasons
   - time to resolve conflicts or update
   - fraction of classifications older than N years
   - VUS-to-definitive rates

   Nobody offers this publicly [src for NCBI; inf for the others].
4. **Conflict lifecycle analytics.** When a conflict appears, which side changes, and how long resolution takes. This also covers the effect of expert panel classifications and flags on the aggregate. It depends on history.
5. **Filtered bulk download with provenance.** Export any filtered set as TSV, VCF, JSON, VA-Spec or Parquet, stamped with the release. There should also be a shareable query URL and an API endpoint for the same result.
6. **Watchlists and alerts beyond NCBI "Follow".** Watch a gene, panel, saved query or submitter, triggered by SCV-level, review-status or somatic changes.
7. **Somatic and oncogenicity browsing.** Facets on tier, oncogenicity value, tumor type and drug. NCBI has only a germline/somatic toggle.
8. **Trend dashboards.** ClinVar Miner's removed over-time graphs, extended: growth, conflicts, VUS sub-tier uptake since 2026-01, method mix, country, by gene or submitter.
9. **Mondo-hierarchy condition rollups.** ClinVar Miner had this; NCBI search does not appear to [inf].
10. **Things worth trialling for NCBI:**
    - an SCV-level submitter facet
    - per-submitter concordance cards on submitter pages
    - a VCV version-history timeline
    - query-level and gene-level Follow
    - a filtered export of `summary_of_conflicting_interpretations` from the web UI

### 4.3 Data notes for the build [inf]

- **History depth.**
  - GKM provides history from 2024 onward; back-releases are planned.
  - Pre-2024 history would need the archived tab-delimited files (submission_summary and the conflict summary, back to 2014/2016), or the old-format XML archive if it is still hosted. `RCV_xml_old_format/` still lists 2025 files.
  - Weekly files are not archived by NCBI, so capture them as they arrive if weekly granularity matters.
- **Benchmarking caveat.** The conflict file has one row per SCV pair, ordered both ways, so counts need de-duplication. It only covers variants with two or more SCVs.
