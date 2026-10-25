# Storage format eval: DuckDB file, parquet, DuckLake

25 October 2026. Whether the derived tables ([schema.md](../schema.md)) should live in a DuckDB database file, in plain parquet queried by DuckDB, or in a table format (DuckLake, Iceberg) over parquet. Small evals on the development Mac (Apple Silicon, 7 threads, DuckDB 1.5.5 CLI), against the 2026-10-18 build. The OS file cache was warm in every run, so "cold" means a fresh DuckDB process, not a cold disk.

## Size

| Format | Size | Notes |
| --- | --- | --- |
| DuckDB file, primary keys only | 5.5 GB | 4.0 GB table data + about 1.5 GB of primary-key indexes |
| DuckDB file, foreign keys enforced | 10.3 GB | as above + about 4.8 GB of foreign-key indexes |
| Parquet, ZSTD, 100k-row groups, rows in the same sorted order | **1.8 GB** | exported from the DuckDB file in 14 s |
| Parquet, ZSTD, 16k-row groups (8 lookup tables only) | 1.1 GB for those 8 | |
| DuckLake, `scv` only, default settings | 679 MB (parquet at 370 MB) | default compression, not tuned |

## Query times (ms)

Eight page-like queries (`data/eval/queries.sql` at the time): Q1 variant page (SCVs with submitter and condition), Q2 variant header (MANE HGVS, VCV calls), Q3 submitter classification counts, Q4 gene classification counts through the gene list, Q5 whole-`scv` crosstab, Q6 P/LP-vs-B/LB pairs in BRCA1, Q7 HGVS prefix `LIKE` over 43M rows, Q8 one SCV by accession. Warm = second run in the same process. The CLI timer rounds to milliseconds.

| Query | DuckDB file (cold / warm) | Parquet views (cold / warm) | Parquet + metadata cache | Parquet 16k groups + cache |
| --- | --- | --- | --- | --- |
| Q1 variant page | 12 / 7 | 25 / 16 | 16 / 15 | 41 / 21 |
| Q2 variant header | 4 / 1 | 17 / 15 | 11 / 12 | 23 / 22 |
| Q3 submitter counts | 11 / 4 | 20 / 11 | 10 / 10 | 35 / 31 |
| Q4 gene counts | 17 / 8 | 37 / 21 | 20 / 21 | 43 / 29 |
| Q5 crosstab | 16 / 15 | 19 / 19 | 18 / 17 | 23 / 22 |
| Q6 gene conflicts | 32 / 27 | 66 / 61 | 58 / 58 | 121 / 110 |
| Q7 HGVS prefix scan | 180 / 138 | 329 / 320 | 315 / 319 | 339 / 320 |
| Q8 SCV by accession | 4 / 1 | 38 / 32 | 34 / 32 | 15 / 14 |

DuckLake, `scv` only: Q3-style submitter counts 14 ms, variant lookup 4 ms.

## Findings

- **Parquet is about 2× slower than the DuckDB file, and still tens of milliseconds** for every page-style query. The gap is largest where DuckDB's own format has an index (Q8: a primary-key lookup on a column the file isn't sorted by) or keeps lighter-weight metadata (Q2).
- **Parquet is 3× smaller** (1.8 GB against 5.5 GB). ZSTD parquet compresses far better than DuckDB's storage.
- **The metadata cache** (`parquet_metadata_cache`) helps a little, as a long-running server would see.
- **Smaller row groups hurt** most queries (more metadata, less parallelism per group). 100k rows is about right.
- **Search needs its own table in either format** (Q7). A sorted term table or full-text index, not `LIKE` over `variant_hgvs`.
- **Lookups on a column the rows aren't sorted by** (Q8) need either a scan (about 30 ms on `scv`) or a small lookup table sorted by that column (e.g. `scv_id → variation_id`).
- **DuckLake** (parquet data files plus a small SQL catalog) performed like the DuckDB file in a one-table trial. Its useful features are snapshots, time travel (`AT (VERSION => n)`) and change feeds between snapshots (`ducklake_table_changes`). Loading each weekly release as changes against the previous one would give release history and release-to-release diffs from the storage layer itself. Not evaluated beyond this.
- **Iceberg** is installed and works with DuckDB, but needs a catalog, and buys interoperability with Spark, Trino, BigQuery and Snowflake that a local app doesn't need. It may matter if we publish derived data for those users.

## Heavier queries: filters and joins on columns the files aren't sorted by

A parquet file has one sort order (here, by `variation_id`), so a filter on any other column can't skip row groups by min/max; DuckDB reads that whole column. These queries test that, with the heaviest "miner" operations: same conditions as above, parquet with the metadata cache, times in ms (cold / warm).

| Query | DuckDB file | Parquet |
| --- | --- | --- |
| H1 submitter vs submitter: Labcorp (2.0M SCVs) vs Ambry (1.8M), P/V/B pairs on shared variants | 68 / 55 | 74 / 65 |
| H2 one submitter vs all others: Labcorp against every lab, shared variants and P-vs-not-P conflicts | 61 / 61 | 103 / 95 |
| H3 condition page: HBOC SCVs by gene and classification (`scv_condition` filtered by condition, sorted by SCV) | 34 / 16 | 72 / 58 |
| H4 global conflict overview: every variant's set of P/V/B calls | 283 / 283 | 292 / 293 |
| H5 every SCV pair on every variant (self-join of 6.8M pathogenicity SCVs) | 115 / 105 | 128 / 125 |
| H6 classifications last evaluated before 2018, by submitter | 8 / 5 | 12 / 10 |
| H7 free text: `description ILIKE '%founder%'` over 6.85M comments | 1305 / 1133 | 1227 / 1223 |
| H8 gene list page: every gene with SCV counts | 93 / 93 | 122 / 110 |
| H9 HGVS exact match over 43M expressions | 178 / 90 | 284 / 251 |

- **Scanning a column we didn't sort by is cheap at this size.** DuckDB reads and decompresses only the columns a query uses, and our largest tables are 7–43M rows. Filters on submitter, date or condition took 10–100 ms.
- **The heaviest joins** (one lab against all others, every SCV pair on every variant) took 100–300 ms. The storage format barely matters for them.
- **The one slow query, free-text search,** is slow in both formats (about 1.2 s). It needs a full-text index or a token table, not a different format.
- **Caveats:** one user, warm OS cache, 7 threads. A 4-core laptop might be about 2× slower, a cold disk slower on the first query, and a hosted instance multiplies the load by concurrent users.

Ways to serve columns other than the sort key while staying on parquet, if a query ever needs it:
- **A second sorted copy** of the few columns a view needs, e.g. `scv` by submitter (`submitter_id, variation_id, scv_id, classification`): tens of MB.
- **Lookup tables** from a key to the sort key (`scv_id → variation_id`), sorted by that key, for point lookups.
- **Bloom filters** (per row group, for equality on values concentrated in few groups); support in DuckDB's parquet writer to be checked.
- **Multi-column clustering** (Z-order or Hilbert curve over two or three columns): partial skipping on each column.
- **Partitioning files** by a low-cardinality column (lane, classification type).
- **Precomputed aggregates and search tables:** the biggest lever for list pages, crosstabs, conflict summaries and search.
