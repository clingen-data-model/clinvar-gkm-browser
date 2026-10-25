# ClinVar GKM browser: search

Status: draft, 25 October 2026. How search works: the tables the derivation builds for it, how queries use them, and what each kind of search costs. Measurements are from a prototype built from the 2026-10-18 derived tables on the development Mac (warm cache, 7 threads). The derived tables are in [schema.md](schema.md).

## What people search for

| Kind | Examples |
| --- | --- |
| Gene | `BRCA1`, `ncbigene:672` |
| Condition | `Hereditary breast ovarian cancer syndrome`, an alias (`Familial cancer of breast`), `MONDO:0011450`, `C0677776` (MedGen), OMIM, Orphanet, HPO codes |
| Submitter | `GeneDx`, `Labcorp` |
| Variant by identifier | `VCV000017662`, `17662`, `rs80357914`, `CA000529`, a VRS ID, SPDI, a VCF-style key (`17-43124027-ACT-A`) |
| Variant by HGVS | `NM_007294.4:c.68_69del`, `NM_007294:c.68_69del`, `BRCA1:c.68_69del`, `BRCA1 c.68_69del`, `p.Glu23fs`, `p.E23fs`, legacy `185delAG` |
| Submission or aggregate | `SCV000020169`, `RCV000077538` |
| Free text | words in submitter comments (`founder`, `functional studies`) |

ClinVar Miner only redirected on exact matches and otherwise fell back to a Google site search.

## The term table

**`search_term`**: one row per searchable string, normalized, pointing at what it identifies.

| Column | Meaning |
| --- | --- |
| `term` | normalized: lower case, whitespace collapsed |
| `kind` | gene, condition, submitter, variant, scv, rcv |
| `target_id` | the ID of what it finds (`gene_id`, `condition_id`, `variation_id`, …) |
| `display` | the original text, for showing matches |
| `rank` | ordering among matches (planned: e.g. preferred name over alias, MANE over other transcripts) |

The table is **sorted by `term`**, so a parquet file plus its per-row-group min/max values acts as an index. An exact or prefix lookup reads the one or two row groups that can contain the term.

**Prototype (2026-10-18):** 108.7M rows, 1.25 GB of ZSTD parquet, 47 s to build. 95.7M rows are variant terms, mostly HGVS: every nucleotide and protein expression in ClinVar's HGVS lists. Then 6.9M SCV accessions, 6.0M RCV accessions, and small numbers of genes (93k), conditions with aliases and codes (86k) and submitters (3.6k).

### Lookups

| Query | Time |
| --- | --- |
| Exact term (`brca1`, `rs80357914`) | 7–10 ms |
| Prefix, written as a range: `term >= 'nm_007294.4:c.68' AND term < 'nm_007294.4:c.69'` | 12 ms |
| The same prefix written as `LIKE 'nm_007294.4:c.68%'` | 450 ms |
| Prefix on a condition name (`hereditary breast`, matching aliases too) | 13 ms |
| Substring anywhere in a term (`LIKE '%68_69del%'`) | 1.2 s |

- **Prefixes must be written as ranges.** DuckDB doesn't skip row groups for `LIKE 'x%'`, so the server's query code turns a prefix into a range.
- **Exact and prefix lookups cover autocomplete and most searches.** Substring matching is a scan, so it's offered only as an explicit fallback ("contains…") if at all.

### Normalization: one variant, many spellings

ClinVar's own HGVS list for one variant mixes forms. Variation 17662 (BRCA1 c.68_69del) appears as `NM_007294.4:c.68_69del`, `NM_007294.4:c.68_69delAG`, `LRG_292t1:c.66_67AG[1]` and `NC_000017.11:g.43124028CT[1]`. Users type yet other forms. Matching is in tiers, cheapest first:

1. **Exact, normalized:** case, whitespace, and the `VCV`/`SCV`/`RCV` zero padding. Done in the prototype.
2. **Generated alternate forms,** added to the term table at build time:
   - the accession without its version (`nm_007294:c.68_69del`);
   - the gene-symbol forms parsed from ClinVar's preferred name `NM_007294.4(BRCA1):c.68_69del (p.Glu23fs)`: `brca1:c.68_69del`, `brca1 c.68_69del`, `brca1 p.glu23fs`;
   - one-letter protein forms (`p.e23fs`);
   - `rs` and `CA` with and without prefixes.

   The versionless form was in the prototype, but a filter bug left it out. Each extra form adds rows, so the table may reach 150–200M rows (about 2 GB).
3. **Query-side parsing:** recognize the shape of the input (accession, rsID, HGVS, gene plus change, VCF key) and look up only the matching kinds. A bare change like `c.68_69del` needs a gene to mean anything; with one gene in context (e.g. on a gene page) it becomes `brca1:c.68_69del`.
4. **True HGVS equivalence:** different descriptions of the same change, such as `c.68_69del` and `c.66_67AG[1]`, or a description on a transcript ClinVar doesn't list. That needs normalizing the input to a VRS allele and matching `allele.allele_id`, which takes a reference sequence and `vrs-python` or `vrs-rust`. Later, if users need it; the identifiers and forms ClinVar itself lists cover most searches.

Legacy names such as `185delAG` appear in submitter comments and some aliases, not in the HGVS list. They need free-text search, or an alias list from somewhere else.

## Free text in comments

4.2M SCVs have a comment: 2.2 GB of text, 3.15M distinct (much is boilerplate repeated across a lab's submissions). Options:

| Option | Cost | Query time |
| --- | --- | --- |
| Scan: `description ILIKE '%founder%'` | none | about 1.2 s |
| Scan over distinct comments only, joined back to SCVs | a small table | expected under 1 s (not measured) |
| Word index: (word, comment) pairs sorted by word, in parquet | 155M rows; about 3 minutes added to each load | expected tens of ms |
| DuckDB's full-text extension (BM25 ranking) | an index inside a DuckDB file, rebuilt each load | fast, ranked; cost not measured |

**Start with the scan.** At about 1.2 s it's inside the 1–2 s budget for an occasional search. Add a word index or the full-text extension if comment search turns out to be used a lot.

## Autocomplete

As the user types, query `search_term` by prefix (about 12 ms) for the first few matches of each kind, ranked. Genes, conditions and submitters are small enough (about 180k terms) to also ship to the browser as a static file and match there instantly, as considered in [architecture.md](architecture.md#search). That's optional; the server lookup is already fast.

## Open questions

1. Which alternate HGVS forms are worth generating, against table size?
2. Ranking rules: preferred names over aliases, MANE Select transcripts first, variants with more submissions first?
3. Should SCV and RCV accessions live in the term table (13M rows) or be parsed and looked up directly? Accessions are a fixed format, so a direct lookup would do, and would make the table 12% smaller.
