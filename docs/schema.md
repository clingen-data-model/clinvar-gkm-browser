# ClinVar GKM browser: derived database schema

Status: draft, 25 October 2026; shape revised 29 October 2026. The schema of the tables the app queries, how one ClinVar-GKM parquet release is loaded into them, and how they're stored.

**Decided 29 October 2026:** **tables keep upstream's shape and names, and its IDs as keys,** except where a change measurably speeds up the app's queries ([Shape](#shape)).

**Decided 25 October 2026:**
- **The derived tables are stored as parquet,** one sorted ZSTD file per table, which the server queries with DuckDB through a view per table ([storage eval](research/storage-format-eval.md)).
- **References are declared and checked, not enforced** ([Faithful to upstream](#faithful-to-upstream)). The SQL is in `packages/derive/sql/`:
- `schema.sql`: the DDL, with primary keys, foreign keys, checks and seeded vocabularies.
- `load.sql`: the load from parquet.
- `validate.sql`: checks run after a load, before a release is switched in.
- `../reference-checks.awk`: generates one check per declared reference from `schema.sql`; see [Faithful to upstream](#faithful-to-upstream).

The source tables are described in [source-schema.md](source-schema.md). Why the app reshapes them is in [data.md](data.md#derived-model).

**Schema version 1.** Loaded from ClinVar-GKM 1.1.0, ClinVar release 2026-10-18 (results below).

## Running it

```sh
scripts/fetch-source.sh              # download and verify the parquet set into data/source/<release>/
scripts/derive.sh [release]          # build data/derived/1/<release>/<table>.parquet
DERIVE_PROFILE=1 scripts/derive.sh   # also print DuckDB memory use by category after every statement
scripts/sql.sh [release]             # DuckDB shell with a view per derived table
```

`derive.sh` uses the DuckDB CLI, with DuckDB's memory limited to 4 GB (`DUCKDB_MEMORY_LIMIT`) to match the podman machine. The steps:
1. Strip the `REFERENCES` clauses from `schema.sql`, keeping primary keys, so duplicate IDs still fail the load.
2. Load into a scratch DuckDB database in `data/tmp/`.
3. Run the generated reference checks and `validate.sql`, which fails the build on any problem.
4. Write every table as `<table>.parquet`: ZSTD, 100k-row groups, in its sorted order. (`EXPORT DATABASE` would lower-case upstream's camelCase table names.)
5. Write `manifest.json` with the release metadata and row counts.
6. Replace `data/derived/1/<release>/` in one step, only if everything succeeded.

From M1 the server runs the same SQL through `@duckdb/node-api`.

A release directory holds `<table>.parquet` for every table and `manifest.json`.

## Design

- **Upstream's shape and names,** unless a change measurably pays for itself ([Shape](#shape)). Tables loaded as published keep upstream's table and column names, camelCase included (`sequenceReference`, `conditionSet`, `conceptType`, `id`), and drop only the columns the app doesn't use. Tables the load reshapes (`variant`, `vcv_statement`, `rcv_statement`, `scv`) or adds use snake_case.
- **Keys are upstream's IDs, never row numbers,** so rebuilding a release gives the same keys, and two releases can be compared row by row. Numeric IDs become integers, dropping the prefix: `variation_id` 10 for `clinvar:10`, `scv_id` 20176 for `SCV000020176`, and `id` in `gene`, `condition` and `submitter`. Integer keys measured 1.6–2.6× faster than the prefixed strings for lookups and joins on `scv`. Other IDs stay as published: GA4GH digests (VRS alleles, locations, refget sequences), condition sets (`clinvar.traitset:…`, `clinvar.conditionset:vcv-…`) and statements (`VCV000000010.141-G-PATH-CP`).
- **Propositions are folded into their statements.** Upstream's propositions are 1:1 with statements, so the variant, condition, predicate, gene context, inheritance and penetrance become columns of `scv`, `vcv_statement` and `rcv_statement`.
- **Nested fields:**
  - on `variant` and `scv`, extension entries (review status, submission level, ...), contributions (submitter, dates) and nested structs (`classification`, `strength`, `specifiedBy`) become typed columns;
  - lists that queries search across rows for a value become tables: a variant's genes, HGVS expressions and cross-references (`variant_gene`, `variant_hgvs`, `variant_xref`), and an SCV's conditions with sets expanded (`scv_condition`);
  - every other list stays on its row as published: a condition's `mappings`, a condition set's `concepts`, an SCV's citations (`reported_in`) and submitted conditions, collection methods, molecular consequences.
- **Every relationship is declared** with a `REFERENCES` clause in `schema.sql`, which documents the model and drives the generated reference checks. The build strips the clauses, so nothing is enforced at load time ([Faithful to upstream](#faithful-to-upstream)). A relationship upstream's data is known to break is declared in a comment instead, `-- REFERENCES … NOT ENFORCED: <reason>`. A list of IDs (a condition set's `concepts`) can't be declared, so isn't checked.
- **Not loaded:** therapies (`therapy`, `therapyGroup`) and the somatic clinical impact evidence lines that use them (`evidenceLine` and the diagnostic, prognostic and therapeutic-response propositions). No page shows them yet.
- **Vocabularies are lookup tables, not ENUMs:** classification types, submission levels, and review statuses with their star ratings. They carry labels and ordering, and a value upstream adds fails the load at its foreign key instead of loading silently. That's what we want for an unattended weekly update: the previous release keeps serving, and the new value is added in a schema version bump.
- **Physical order.** Rows are inserted sorted by their main lookup key: `scv`, the statement trees and the variant list tables by `variation_id`, locations by sequence and position. DuckDB's per-block min/max statistics then skip most of a table for a lookup, without an index.
- **Upstream's `data` JSON isn't copied** ([source-schema.md](source-schema.md#what-to-do-with-data)).

## Shape

Decided 29 October 2026: **a table stays in upstream's shape unless reshaping it makes the app's queries measurably faster.** Each reshaping below was measured by undoing it alone on the 2026-10-18 data and timing the queries the app runs. Same row order and compression throughout; DuckDB over parquet, 7 threads, warm cache, median of 3 runs; method and queries in [research/upstream-shape.md](research/upstream-shape.md).

**Kept, because they pay for themselves:**

| Reshaping | Upstream's shape | Ours | |
| --- | --- | --- | --- |
| `scv` extensions and contributions as columns (submitter, dates, review status, level) | 0.050–3.29 s | 0.005–0.046 s | 7–70× faster, and 48% smaller |
| Propositions folded into `scv` (its variant, condition, gene context) | 0.061–0.177 s | 0.005–0.046 s | 3–12× |
| `scv` nested structs as columns (`classification`, `strength`, `specifiedBy`) | 0.056–0.131 s | 0.005–0.037 s | 4–11×: reading one field of a struct reads all of it |
| The variant's gene list as `variant_gene` (a gene's variants) | 0.191 s | 0.034 s | 5.6× |
| The variant's HGVS list as `variant_hgvs` (HGVS search) | 2.1 s | 0.41 s | 5× |
| The variant's cross-references as `variant_xref` (rsID, ClinGen allele search) | 0.22 s | 0.04 s | 5.5× |
| Integer IDs instead of prefixed strings (lookups and joins on `scv`) | 0.008–0.088 s | 0.005–0.046 s | 1.6–2.6×; no size difference |

**Undone, because they didn't:**
- **Renames** (`sequence_reference`, `condition_set`, `id` → `condition_id`, ...): no effect on speed.
- **Merging the two copy-number tables:** no effect; they're small.
- **Lists read for one record** (a condition's mappings, an SCV's citations and submitted conditions) as child tables. On the row they take 4–26 ms instead of 1–4 ms. That's measurable but small next to a page's other queries, and not worth a table each.
- **Row-number surrogate keys** for condition sets and statements. They also renumbered on every rebuild, since one new statement shifts the keys after it.
- **Tables no page reads** (condition set members, therapies, somatic impact details): left in upstream's shape, or not loaded.

## Faithful to upstream

Decided 25 October 2026: **the derived database represents ClinVar and ClinVar-GKM as published, including where they're wrong.** The load never invents, drops or repairs rows to satisfy a constraint.

- **A relationship the data breaks isn't enforced.** In 2026-10-18 there's one: 31 SCV propositions name 3 NCBI genes (GLRA4, CCDC144NL, RNU6-81P) that upstream's `gene` table lacks. `scv.gene_context_id` keeps those IDs, and its reference to `gene` is declared `NOT ENFORCED`. Queries that join to `gene` should LEFT JOIN.
- **Every declared relationship is checked after each load.** `reference-checks.awk` turns each `REFERENCES` clause (and each `NOT ENFORCED` comment) in `schema.sql` into an anti-join. Dangling values go in the `reference_issue` table: child table and column, parent table and column, missing value, rows affected. The 44 checks take about 2 s.
- **`reference_issue` is data,** not a log. The SQL console can query it, and the app can show it (e.g. a data-quality page, or a note on an affected SCV). Issues there are worth reporting upstream.
- **A relationship that breaks in a future release loads anyway,** and appears in `reference_issue`.
- **IDs are kept as published,** not translated through a lookup join, so a missing target is a dangling value the reference checks report rather than a NULL they can't see. `validate.sql` also checks that every non-root statement has a parent.

## Tables

Generated from the `REFERENCES` clauses in `packages/derive/sql/schema.sql` by `scripts/schema-diagrams.sh`; a dashed line is a reference declared `NOT ENFORCED`. [upstream-vs-derived.md](upstream-vs-derived.md#diagrams) sets each beside upstream's.

**Variants:**

<!-- schema-diagram area=variant -->
```mermaid
erDiagram
  sequenceReference ||--o{ location : "sequence_reference_id"
  location ||--o{ allele : "location_id"
  location ||--o{ copyNumberCount : "location_id"
  location ||--o{ copyNumberChange : "location_id"
  allele |o--o{ variant : "allele_id"
  copyNumberCount |o--o{ variant : "copy_number_count_id"
  copyNumberChange |o--o{ variant : "copy_number_change_id"
  location |o--o{ variant : "defining_location_id"
  variant ||--o{ variant_gene : ""
  gene ||--o{ variant_gene : "gene_id"
  variant ||--o{ variant_hgvs : ""
  variant ||--o{ variant_xref : ""
```
<!-- /schema-diagram -->

**Submissions, aggregates and conditions** (the condition tables declare no references of their own):

<!-- schema-diagram area=submission -->
```mermaid
erDiagram
  variant ||--o{ vcv_statement : ""
  vcv_statement |o--o{ vcv_statement : "parent_statement_id"
  condition |o--o{ vcv_statement : "condition_id"
  conditionSet |o--o{ vcv_statement : "condition_set_id"
  variant ||--o{ rcv_statement : ""
  rcv_statement |o--o{ rcv_statement : "parent_statement_id"
  condition |o--o{ rcv_statement : "condition_id"
  conditionSet |o--o{ rcv_statement : "condition_set_id"
  variant ||--o{ scv : ""
  submitter ||--o{ scv : "submitter_id"
  condition |o--o{ scv : "condition_id"
  conditionSet |o--o{ scv : "condition_set_id"
  gene |o..o{ scv : "gene_context_id, not enforced"
  vcv_statement ||--o{ scv : "vcv_statement_id"
  rcv_statement ||--o{ scv : "rcv_statement_id"
  scv ||--o{ scv_condition : ""
  condition ||--o{ scv_condition : "condition_id"
  conditionSet |o--o{ scv_condition : "via_condition_set_id"
  scv ||--o{ scv_classification_pair : "a_scv_id"
  scv ||--o{ scv_classification_pair : "b_scv_id"
  variant ||--o{ scv_classification_pair : ""
```
<!-- /schema-diagram -->

The vocabulary tables (`classification_type`, `classification_term`, `submission_level`, `review_status`), the release metadata (`release`, `source_file`) and `reference_issue` are left out of the diagrams.

| Table | Key | One row per | From (upstream) |
| --- | --- | --- | --- |
| `release`, `source_file` | | the release; each parquet file | `manifest.json` |
| `reference_issue` | | dangling value of a declared reference | generated checks, after the load |
| `classification_type`, `submission_level`, `review_status` | code / status | vocabulary entry | seeded in `schema.sql` |
| `sequenceReference` | `id` | RefSeq sequence | `sequenceReference`, as published |
| `location` | `id` | VRS sequence location | `location`, as published |
| `allele` | `id` | VRS allele, with SPDI, a VCF-style key and its state from `data` as columns | `allele` |
| `copyNumberCount`, `copyNumberChange` | `id` | VRS copy-number count; change | `copyNumberCount`, `copyNumberChange`, as published |
| `gene` | `id` | NCBI gene | `gene`, as published |
| `variant` | `variation_id` | ClinVar variation, with its one VRS member | `variation` (+ VCV version from `vcv` IDs) |
| `variant_gene` | (`variation_id`, `gene_id`) | entry in the variant's gene list | `variation.extensions` `clinvarGeneList` |
| `variant_hgvs` | | entry in the variant's HGVS list | `variation.extensions` `clinvarHgvsList` |
| `variant_xref` | | identifier in another system | `variation.mappings` |
| `condition` | `id` | ClinVar trait, with its mappings | `condition`, as published |
| `conditionSet` | `id` | TraitSet or minted set, with its members | `conditionSet`, as published |
| `submitter` | `id` | organization | `submitter`, as published |
| `vcv_statement` | `statement_id`, checked not indexed | VCV statement node: root, level or tier | `vcv` + its proposition + `vcv_evidenceLine` |
| `rcv_statement` | `statement_id`, checked not indexed | RCV statement node | `rcv` + its proposition + `rcv_evidenceLine` |
| `scv` | `scv_id` | submission, with its citations and submitted conditions | `scv` + its proposition + the VCV/RCV statements citing it |
| `scv_condition` | (`scv_id`, `condition_id`) | condition the SCV is about, sets expanded | the proposition's object |
| `scv_classification_pair` | (`a_scv_id`, `b_scv_id`), checked not indexed | every ordered pair of SCVs conflict detection compares, with its level and condition flags ([data.md](data.md#conflicts)) | derived from `scv` |

### Aggregate statement trees

A VCV or RCV accession is a tree: one root per classification type, citing one node per submission level, each citing its SCVs. Somatic clinical impact adds a tier node between level and SCVs. Upstream encodes this in statement IDs and evidence lines; here it's `node_kind`, `parent_statement_id` and `contributes`, one row per upstream statement:

```
VCV000000010.141-G-PATH            root    classification 'Pathogenic'
├── VCV000000010.141-G-PATH-CP     level   contributes = true    ← 45 scv rows have this vcv_statement_id
├── VCV000000010.141-G-PATH-NOCP   level   contributes = false   ← 8 scv rows
└── VCV000000010.141-G-PATH-FLAG   level   contributes = false   ← 2 scv rows
VCV…-S-SCI                         root    (somatic clinical impact, illustrative)
└── VCV…-S-SCI-CP                  level
    └── VCV…-S-SCI-CP-T1           tier                          ← scv rows
```

Every SCV is cited by exactly one VCV node and one RCV node (checked against the 2026-10-18 data). Those become `scv.vcv_statement_id` and `scv.rcv_statement_id`, both NOT NULL. The node's variant, classification type and level always match the SCV's (also checked), and `validate.sql` re-checks this every load.

## How the load works

`load.sql` runs as one script against the scratch database, with a second scratch database attached as `stage` for intermediate tables. The order:

1. **Stage the propositions** (`stage.prop`, 28M rows): every proposition table read once, with the variant ID parsed to an integer.
2. **Release metadata** from `manifest.json`.
3. **Genome:** `sequenceReference`, `location`, `allele` (SPDI, VCF key and state parsed from `data`), `copyNumberCount`, `copyNumberChange`.
4. **Genes and variants:** `gene`, `variant`, then its gene list, HGVS list and cross-references from a staged copy of `variation`'s nested columns.
5. **Conditions:** `condition`, `conditionSet`, a staged condition-set expansion (nested TraitSets resolved), `submitter`.
6. **Aggregate statements:** evidence-line edges staged; VCV and RCV statements staged together, joined to their propositions and to the edge naming each one's parent; then each tree inserted, sorted by variant.
7. **SCVs:**
   - `scv.parquet` is flattened to scalar columns in one streaming pass;
   - the SCV propositions are filtered out of `stage.prop`;
   - the two are joined, with the citing statements and condition sets, sorted by variant, and inserted.
8. **SCV conditions:** `scv_condition`, with condition sets expanded.
9. **Classification pairs:** `scv_classification_pair`, a self-join of `scv` within each variant and conflict-detectable type, both orders, sorted by side A's submitter then variant. `validate.sql` checks that the count is n×(n−1) per group, that each pair's reverse exists with the same level, and that no pair repeats.
10. **Reference checks** (generated from `schema.sql`) fill `reference_issue`.
11. **`validate.sql`,** then **export** to parquet. The scratch databases are deleted.

## Load performance: what we learned

The load has to fit the 4 GiB podman machine. Getting there took four failed or slow runs; `DERIVE_PROFILE=1` and `EXPLAIN ANALYZE` showed why.

- **Wide nested values through a join and sort ran out of memory.** The first `scv` insert joined raw `scv` rows to the 28M propositions and sorted the result. The raw rows carry nested `extensions`, `contributions` and citation structs. It failed at the 4 GB limit even with spilling, on a small allocation DuckDB couldn't spill. Flattening `scv.parquet` first, then joining narrow tables, fits. The three nested values `scv` keeps (citations and the submitted condition or set) go through the join too, and still fit: the insert takes 24 s.
- **Most memory between statements was evictable.** Measured after each statement: cached table blocks peaked around 1.7 GB, which DuckDB evicts as needed, and indexes held about 300 MB. Neither caused the failure.
- **Staging tables go in an attached file.** They're ordinary tables in `stage.duckdb`, not `CREATE TEMP TABLE` (DuckDB's in-memory temp catalog). They can be evicted to disk, and dropping them leaves no dead space in the main database (DuckDB reuses freed blocks but doesn't shrink files).
- **An `AND` in a join's `ON` clause can turn a hash join into a nested loop.** `LEFT JOIN condition_set ON object_type = 'conditionSet' AND condition_set_id = object_id` compared 6.85M rows with 100k sets: 10 minutes of one statement. Writing it as `ON condition_set_id = CASE WHEN object_type = 'conditionSet' THEN object_id END` keeps it a hash join: 52 s with foreign keys, 12 s without. Upstream's `joining.md` warns about the same thing.
- **Every foreign key builds an index.** DuckDB builds an ART index on the referencing columns, not just for primary keys (`scv` has 11). That roughly doubles the file and slows inserts. See [Results](#results).
- **Indexes on strings are the costly ones.** A `UNIQUE` on the 21M statement ID strings was dropped; `validate.sql` checks their uniqueness instead.
- **The process exceeds DuckDB's own limit.** Resident memory peaked at 6.9–7.4 GB with `memory_limit` at 4 GB, measured on macOS. Some memory falls outside DuckDB's budget, or isn't returned to the system promptly. This has to be checked inside a 4 GiB container before we rely on it.

## Results

ClinVar release 2026-10-18, on the development Mac (Apple Silicon, 7 threads, DuckDB 1.5.5 CLI, `memory_limit` 4 GB). Built from the 13.2 GB parquet set already downloaded.

| | |
| --- | --- |
| Build time, download excluded | 2.9 min (29 October 2026; 2.5 min before the shape change) |
| Output | 1.9 GB of parquet (25 tables) |
| Peak resident memory | about 7.9 GB, against the 4 GB `memory_limit` (measured before the shape change) |
| Reference checks | 44 relationships, about 2 s; one issue (below) |
| `validate.sql` | passes |

- **Row counts:** `variant_hgvs` 43.4M, `scv_classification_pair` 15.3M, `rcv_statement` 12.1M, `variant_xref` 10.6M, `vcv_statement` 9.2M, `variant_gene` 7.4M, `scv_condition` 7.3M, `scv` 6.85M, `variant` 4.69M, `allele` 4.60M, `location` 4.22M.
- **One integrity gap upstream.** 31 SCV propositions name 3 NCBI genes (GLRA4, CCDC144NL, RNU6-81P) missing from upstream's `gene` table. Kept as published and listed in `reference_issue` ([Faithful to upstream](#faithful-to-upstream)). Every other reference resolves. Worth reporting to ClinVar-GKM.
- **Query times** against these files, for page-style and heavy "miner" queries: 10–300 ms, except free-text comment search at about 1.2 s ([storage eval](research/storage-format-eval.md)).

**Earlier alternatives, measured on the same data:**

| | Build | Size |
| --- | --- | --- |
| DuckDB file, foreign keys enforced | 6.7 min | 10.3 GB |
| DuckDB file, primary keys only | 2.4 min | 5.5 GB |
| Parquet (chosen) | 2.5 min | 1.9 GB |

- **Enforced foreign keys cost 4.8 GB of indexes and about 4.3 minutes, and bought no query speed.** DuckDB builds an index for every foreign key. A variant's SCVs came back in 1–3 ms either way, because rows are sorted by variant. Counting one submitter's SCVs took 210–280 ms with the index and 4–9 ms without.
- **The DuckDB file queried about 2× faster than parquet,** still within tens of milliseconds for pages, at 3× the size. Parquet also keeps the data readable outside DuckDB and independent of DuckDB's storage version.

## Open questions

1. **`variant_hgvs` is the largest table** (43M expressions). Keep all of them, or only those needed for display and search: MANE, genomic top-level and protein?
2. **Lookup tables vs ENUMs** for the vocabularies: lookup tables were chosen for labels and foreign keys. Revisit if join cost shows up in query benchmarks.
3. **Page-serving tables** (crosstabs, search terms, conflict pairs) come next, as a second layer over these tables, sized by M0's query benchmarks.
