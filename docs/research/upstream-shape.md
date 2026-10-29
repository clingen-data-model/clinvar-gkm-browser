# Upstream's shape vs ours: what each reshaping costs

28–29 October 2026. Which of the derivation's changes to upstream's table shapes ([schema.md](../schema.md#shape)) make the app's queries faster, measured one change at a time. The resulting decision is in schema.md.

## Method

- Data: the 2026-10-18 release, derived with schema version 1 as it stood on 28 October, before this review.
- For each change, the derived table was rebuilt with only that change undone: upstream's columns put back for ours, joined in from the source parquet. Row order (by `variation_id`, then `scv_id`) and ZSTD compression stayed the same.
- Queries are those the app runs, or reduced versions of them. Each ran over parquet views in the DuckDB 1.5.5 CLI on the development Mac (Apple Silicon, 7 threads). Each query ran four times, and the time given is the median of the last three (warm cache).
- One caveat favours the variants slightly: the variant files used default 122,880-row groups, while derived files use 100k.

## `scv`: extensions, contributions, propositions, structs, IDs

Variant files, each `scv` with one change undone:
- **ext:** `contributions` and `extensions` lists in place of `submitter_id`, the dates, review status and submission level. 562 MB vs 380 MB.
- **noprop + prop:** the proposition left out, joined back from a 6.85M-row `scv_prop` table.
- **struct:** `classification`, `strength` and `specifiedBy` as upstream's structs. 450 MB.
- **str:** IDs as upstream's prefixed strings (`clinvar.submitter:500031`, `clinvar:10`). 377 MB.

| Query | Ours | ext | prop | struct | str |
| --- | --- | --- | --- | --- | --- |
| QA: a gene's SCVs by submitter and term (BRCA1) | 0.034 | 0.225 | 0.110 | | 0.088 |
| QB: one lab's 1-star+ pathogenicity SCVs, counted | 0.046 | 3.29 | 0.177 | | 0.076 |
| QC: one variant's SCVs | 0.005 | 0.050 | 0.061 | | 0.008 |
| QD: SCVs per submitter, top 10 | 0.011 | not recorded | | | 0.011 |
| QE: pathogenicity classifications, top 5 | 0.017 | | | 0.080 | |
| QF: one variant's classification, strength, criteria | 0.005 | | | 0.056 | |
| QG: SCVs with collection method "clinical testing" | 0.037 | | | 0.131 | |

The gene lookup in QA, run over upstream's gene list (a list of structs on each variation) instead of `variant_gene`: 0.191 s against 0.034 s.

Reading one field of a struct read the whole struct, nested lists included, which is why the struct columns cost as much as they did.

## Lists on the row vs a child table

Variant files keep upstream's lists on the parent row:
- `variant` with the HGVS list and `mappings`: 733 MB, against 679 MB for `variant` plus `variant_hgvs` plus `variant_xref`.
- `scv` with `reportedIn` and the submitted condition(s): 487 MB, against 430 MB for `scv` plus `scv_citation` plus `scv_submitted_condition`.
- `condition` with `mappings`.

| Query | Child table | List on the row |
| --- | --- | --- |
| HGVS search, c. expression | 0.415 | 2.158 |
| HGVS search, p. expression | 0.405 | 2.107 |
| rsID search | 0.040 | 0.225 |
| ClinGen allele ID search | 0.039 | 0.236 |
| One variant's HGVS list | 0.007 | 0.103 |
| One variant's cross-references | 0.002 | 0.019 |
| One condition's mappings | 0.001 | 0.004 |
| One SCV's citations | 0.004 | 0.026 |
| One SCV's submitted conditions | 0.002 | 0.014 |
| A scan of `scv` (SCVs per submitter, one review status) | 0.011 | 0.012 |

- **A search across rows for a value in a list is about 5× slower,** because every row's whole list is read and unpacked. That keeps `variant_hgvs` and `variant_xref`.
- **Reading one record's list is slower too.** Its row group (100k rows of bulky nested lists) has to be decompressed to reach one row. Smaller row groups, of 10k variants or 20k SCVs, brought the variant's HGVS list down to 0.032 s. But they tripled the `scv` scan to 0.032 s, so they aren't a free fix.
- **For a condition's mappings and an SCV's citations and submitted conditions,** the 3–22 ms difference is small next to a page's other queries. They stay on the row.

## Not measured

- **Renames** (`variation` → `variant`, `id` → `condition_id`, camelCase → snake_case) can't affect speed. They were undone for tables the load doesn't reshape.
- **Merging the two copy-number tables** (47k and 32k rows): too small to matter.

## Keys

The surrogate keys (`condition_set_key`, `vcv_statement_key`, `rcv_statement_key`, `parent_key`) were `row_number()` over the sort order. A new statement on one variant shifted the keys of every statement after it. So a rebuild of the next release would see most `scv` and statement rows as changed, even where nothing upstream changed. Upstream's statement and condition set IDs are stable, and these are small enough tables that string keys cost little. They replace the surrogate keys.
