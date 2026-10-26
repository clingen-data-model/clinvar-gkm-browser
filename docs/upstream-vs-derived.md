# ClinVar GKM browser: upstream schema vs derived schema

Status: draft, 25 October 2026. What changes between ClinVar-GKM's published parquet and the derived tables the app queries, and why, with examples from the 2026-10-18 release.

The two schemas are documented separately: upstream in [source-schema.md](source-schema.md), derived in [schema.md](schema.md). The reasoning behind the derived model is in [data.md](data.md#derived-model). This page sets them side by side. The SQL that does the conversion is `packages/derive/sql/load.sql`.

## At a glance

| | Upstream (ClinVar-GKM parquet 1.1) | Derived (schema version 1) |
| --- | --- | --- |
| **Purpose** | A faithful tabular form of the GA4GH JSON bundle | Fast pages and API queries |
| **Files** | 22 tables, one per bundle section | 32 tables, including 4 vocabularies, 3 release and data-quality tables, and the classification pairs |
| **Size** | 13.2 GB | 2.1 GB |
| **Row model** | One GA4GH object per row (a statement, a proposition, an allele) | One entity per row (a submission, a variant), with 1:1 objects folded together |
| **IDs** | Prefixed strings: `clinvar:10`, `clinvar.submission:SCV000020176.2`, `clinvar.submitter:506395` | Integers named after the entity: `variation_id` 10, `scv_id` 20176, `submitter_id` 506395. GA4GH digests stay as published |
| **Nested fields** | `extensions` lists of `{name, value_…}` structs, `contributions` arrays, nested STRUCTs | Typed columns, or child tables for real lists |
| **Propositions** | 4 tables, 28M rows, each 1:1 with a statement | Folded into their statement's row |
| **Aggregates (VCV/RCV)** | Statement rows linked by evidence-line rows, with structure encoded in ID strings | One table per tree, with `node_kind`, `parent_key` and `contributes` |
| **Vocabularies** | Free text in the data | Lookup tables (classification types and terms, submission levels, review statuses with stars) |
| **`data` column** | Each row's full GA4GH JSON, 60–70% of the bytes | Not copied |
| **Physical order** | Unsorted, SNAPPY | Sorted by each table's main lookup key, ZSTD |
| **Relationships** | Implicit in ID shapes and seams | Declared with `REFERENCES`, checked after every load, and breaks listed in `reference_issue` |
| **Precomputed results** | None | `scv_classification_pair`: every pair of SCVs conflict detection compares, with its level |

## Table map

Every upstream table and where its content goes:

| Upstream table | Rows | Size | Derived table(s) | Size |
| --- | ---: | ---: | --- | ---: |
| `variation` | 4.69M | 3.93 GB | `variant`, plus child tables `variant_gene`, `variant_hgvs`, `variant_xref` | 0.71 GB |
| `scv` | 6.85M | 3.23 GB | `scv`, plus child tables `scv_citation` and `scv_submitted_condition` | 0.43 GB |
| `propositionPathogenicity`, `propositionClinvarCustom`, `propositionOncogenicity`, `propositionSomaticClinicalImpact` | 28.1M | 1.51 GB | Folded into `scv`, `vcv_statement`, `rcv_statement` and `scv_somatic_impact` | — |
| `allele` | 4.60M | 1.12 GB | `allele` (adds HGVS g., SPDI and a VCF key parsed from `data`) | 0.36 GB |
| `location` | 4.22M | 0.71 GB | `location` | 0.14 GB |
| `rcv` + `rcv_evidenceLine` | 12.1M + 12.2M | 1.51 GB | `rcv_statement` | 0.18 GB |
| `vcv` + `vcv_evidenceLine` | 9.17M + 9.38M | 1.18 GB | `vcv_statement`; also `variant.vcv_version` | 0.10 GB |
| `copyNumberCount`, `copyNumberChange` | 47k + 32k | 14 MB | `copy_number` (with `kind`: count or change) | 4 MB |
| `conditionSet` | 101k | 11 MB | `condition_set`, `condition_set_member` | 3 MB |
| `condition` | 23k | 5 MB | `condition`, `condition_xref` | 0.7 MB |
| `gene` | 93k | 5 MB | `gene` | 0.5 MB |
| `evidenceLine` | 1.6k | 0.15 MB | `scv_somatic_impact` | 0.01 MB |
| `submitter` | 3,565 | 0.3 MB | `submitter` | 0.08 MB |
| `sequenceReference` | 214 | 29 KB | `sequence_reference` | 7 KB |
| `therapy`, `therapyGroup` | 38, 10 | 13 KB | `therapy`, `therapy_group`, `therapy_group_member` | 6 KB |
| `manifest.json` | | | `release`, `source_file` | |

Tables with no upstream counterpart:

| Derived table | What it is |
| --- | --- |
| `scv_condition` (7.3M, 25 MB) | Every condition an SCV is about, with condition sets expanded, nested TraitSets included. Resolves upstream's `object_id` + `object_type` seam once at load |
| `scv_classification_pair` (15.3M, 164 MB) | Every ordered pair of SCVs on the same variant and conflict-detectable classification type, with its conflict level and condition flags ([data.md](data.md#conflicts)) |
| `classification_type`, `classification_term`, `submission_level`, `review_status` | Vocabularies seeded from ClinGen's bq-tools, with labels, ordering, significance groups and stars |
| `reference_issue` | Every value that breaks a declared relationship ([Faithful to upstream](schema.md#faithful-to-upstream)) |

## One SCV in both shapes

SCV001800608, version 1: a benign classification from submitter 506395 on variant 133445.

**Upstream: two rows in two tables,** plus the nested structures inside them.

`scv.parquet`, selected columns:

```
                 id = clinvar.submission:SCV001800608.1
classification.name = Benign
classification.primaryCoding.code = benign
       quality.name = no assertion criteria provided
          direction = disputes
     proposition_id = SCV001800608-PATH
         extensions = [clinvarScvId, clinvarScvVersion, submittedCondition,
                       clinvarScvReviewStatus, submittedScvLocalKey, submissionLevel]   ← names only
      contributions = [{contributor: clinvar.submitter:506395, date: 2021-08-21, activityType: submitted},
                       {contributor: clinvar.submitter:506395, date: 2021-08-21, activityType: created},
                       {contributor: clinvar.submitter:506395, date: NULL,       activityType: evaluated}]
               data = {...1.8 KB of JSON...}
```

`propositionPathogenicity.parquet`, the row whose `id` is the SCV's `proposition_id`:

```
                 id = SCV001800608-PATH
 subject_variant_id = clinvar:133445
          object_id = clinvar.trait:16789
        object_type = condition
          predicate = isCausalFor
    gene_context_id = ncbigene:25
```

**Derived: one row in `scv`.** The other tables are reached by integer keys.

```
                  scv_id = 1800608               ← from 'clinvar.submission:SCV001800608.1'
             scv_version = 1
            variation_id = 133445                ← proposition.subject_variant_id
            submitter_id = 506395                ← contributions[activityType = submitted].contributor
     classification_type = PATH                  ← the code at the end of proposition_id
        submission_level = NOCP                  ← extensions[submissionLevel]
           review_status = no assertion criteria provided   ← extensions[clinvarScvReviewStatus]
          classification = Benign
     classification_code = benign
                    term = b                     ← matched to classification_term (vocabulary)
               direction = disputes
                strength = Definitive
          date_submitted = 2021-08-21            ← contributions[submitted].date
            date_created = 2021-08-21            ← contributions[created].date
     date_last_evaluated = NULL                  ← contributions[evaluated].date
               local_key = :Chr.9_133759793_133759793_G_A|not specified
               predicate = isCausalFor           ← proposition
            condition_id = 16789                 ← proposition.object_id, as object_type = condition
       condition_set_key = NULL
           condition_ids = [16789]               ← all conditions, sets expanded (derived)
   condition_unspecified = true                  ← trait 16789 is "not specified" (derived)
         gene_context_id = 25                    ← proposition.gene_context_id
     gene_context_symbol = ABL1
       vcv_statement_key = 196273                ← the VCV level statement citing this SCV
       rcv_statement_key = 461045                ← the RCV level statement citing this SCV
```

Upstream, the citing VCV and RCV statements can only be found by searching `vcv_evidenceLine.evidence_items` and `rcv_evidenceLine.evidence_items` for the SCV's ID. Here they're two columns.

## The same question in both shapes

How many 1-star-or-better pathogenicity SCVs does Labcorp (submitter 500031) have, and on how many variants?

**Upstream:** two joins (scv → proposition → variation), with list lambdas to dig into `contributions` and `extensions`, and string matching on IDs.

```sql
SELECT count(*) AS scvs, count(DISTINCT v.id) AS variants
FROM read_parquet('scv.parquet') s
JOIN read_parquet('proposition*.parquet') p ON p.id = s.proposition_id
JOIN read_parquet('variation.parquet') v ON v.id = p.subject_variant_id
WHERE list_filter(s.contributions, lambda c: c.activityType = 'submitted')[1].contributor
        = 'clinvar.submitter:500031'
  AND s.proposition_id LIKE '%-PATH'
  AND list_filter(s.extensions, lambda x: x.name = 'clinvarScvReviewStatus')[1].value_string
        IN ('criteria provided, single submitter', 'reviewed by expert panel', 'practice guideline');
```

**Derived:** one table, plain columns, and stars from the vocabulary.

```sql
SELECT count(*) AS scvs, count(DISTINCT variation_id) AS variants
FROM scv
WHERE submitter_id = 500031 AND classification_type = 'PATH'
  AND review_status IN (SELECT status FROM review_status WHERE stars >= 1);
```

Both return 2,034,417 SCVs on 2,033,844 variants. On the development Mac (DuckDB 1.5.5, 7 threads, warm cache), the upstream query took **1.65 s** (17 s of CPU), and the derived one took **0.03 s**. The upstream query has to hand-list the review statuses that count as 1 star or more, because upstream has no star field.

## What changes, in detail

### IDs become integers

| Upstream | Derived |
| --- | --- |
| `clinvar:10` | `variation_id = 10` |
| `clinvar.submission:SCV000020176.2` | `scv_id = 20176`, `scv_version = 2` |
| `clinvar.submitter:500034` | `submitter_id = 500034` |
| `clinvar.trait:9580` | `condition_id = 9580` |
| `ncbigene:675` | `gene_id = 675` |
| `RCV003486676.1-G-PATH-CP` | `rcv_statement_key` (surrogate), plus `rcv_accession = 3486676`, `rcv_version = 1`, `classification_type = 'PATH'`, `submission_level = 'CP'`; `statement_id` keeps the original string |
| `clinvar.traitset:<n>`, `clinvar.conditionset:vcv-<md5>` | `condition_set_key` (surrogate), plus `traitset_id`; `condition_set_id` keeps the original string |
| `ga4gh:VA.…`, `ga4gh:SL.…`, `SQ.…`, `clinvar.therapy:<sha256>` | Unchanged |

Integer keys are smaller and compare faster, and they're the IDs people use in ClinVar URLs. Information packed into upstream ID strings (classification type, lane, level, tier, version) becomes columns.

### Propositions fold into statements

Upstream separates what is claimed (a proposition: variant, condition, predicate, gene context, inheritance, penetrance) from who claimed it (a statement). Every statement has exactly one proposition, so in practice the proposition is a side table that every query has to join, at 28M rows. The derived tables copy the proposition's fields onto the statement's row:
- **SCV propositions** become columns of `scv`: `variation_id`, `predicate`, `condition_id` or `condition_set_key`, `mode_of_inheritance`, `penetrance`, `gene_context_*`, `submitted_gene_symbols`.
- **VCV and RCV propositions** become columns of `vcv_statement` and `rcv_statement`.
- **Somatic diagnostic, prognostic and therapeutic-response propositions,** which only `evidenceLine` targets, go with their evidence line into `scv_somatic_impact`.

The proposition tables have no derived counterpart.

### Nested fields become columns or child tables

| Upstream field | Derived |
| --- | --- |
| `scv.extensions` → `clinvarScvReviewStatus` | `scv.review_status` |
| `scv.extensions` → `submissionLevel` | `scv.submission_level` |
| `scv.extensions` → `submittedScvClassification` | `scv.submitted_classification` |
| `scv.extensions` → `submittedScvLocalKey` | `scv.local_key` |
| `scv.extensions` → `submittedCondition` / `submittedConditionSet` | `scv_submitted_condition`, one row per condition as submitted, with its match |
| `scv.contributions[]` | `scv.submitter_id`, `date_submitted`, `date_created`, `date_last_evaluated` |
| `scv.specifiedBy.methodType` (comma-joined text) | `scv.collection_methods` (a list) |
| `scv.specifiedBy.name` | `scv.assertion_criteria` |
| `scv.classification.name`, `.primaryCoding.code`, `strength.name` | `scv.classification`, `classification_code`, `strength` |
| `scv.reportedIn[]` | `scv_citation`, one row per citation |
| `variation.extensions` → `clinvarVariationType`, `clinvarSubclassType`, `clinvarCytogeneticLocation`, … | `variant` columns |
| `variation.extensions` → `clinvarGeneList` | `variant_gene` |
| `variation.extensions` → `clinvarHgvsList` | `variant_hgvs` (MANE flags, protein expression and molecular consequences as columns) |
| `variation.mappings[]` | `variant_xref` |
| `variation.members[]`, `constraints[]` | `variant.allele_id`, `copy_number_id`, `defining_location_id` |
| `condition.mappings[]` | `condition_xref` |
| `conditionSet.concepts[]` | `condition_set_member` |
| `vcv`/`rcv` `classification.extensions` → `conflictingExplanation`; `extensions` → `clinvarReviewStatus` | `*_statement.conflicting_explanation`, `review_status` |

Short lists with nothing to join to stay as lists: `collection_methods`, `submitted_gene_symbols`, `condition.aliases`, `variant_hgvs.molecular_consequences`.

Upstream, filtering on review status means `list_filter(extensions, lambda x: x.name = 'clinvarScvReviewStatus')[1].value_string` on every row. Here it's `review_status = …`, and DuckDB can use column statistics to skip blocks.

### Aggregate statements become trees

Upstream, a VCV accession is a set of statement rows (a root per classification type, one per submission level, a tier for somatic clinical impact) connected by evidence-line rows whose `evidence_items` list the cited statements or SCVs. Its structure lives in ID strings like `VCV000000010.141-G-PATH-CP` and in the `.contributing` / `.non-contributing` suffix of evidence-line IDs.

Derived, each tree is one table with explicit structure:
- `node_kind`: root, level or tier;
- `parent_key`: the node one step up;
- `contributes`: whether the node counts toward its parent's call;
- each SCV's `vcv_statement_key` and `rcv_statement_key`: the level node that cites it.

The four evidence-line and statement tables (43M rows, 2.7 GB) become two tables (21M rows, 0.28 GB). The diagram is in [schema.md](schema.md#aggregate-statement-trees).

### Conditions are resolved once

Upstream, a proposition's `object_id` points at a condition or a condition set, depending on `object_type`. A set can contain another ClinVar TraitSet, and an inner join to `condition` alone silently drops the 10.6% of propositions whose object is a set ([Joins that lie](source-schema.md#joins-that-lie)).

Derived:
- `scv.condition_id` or `scv.condition_set_key`, exactly one of them (a CHECK);
- `scv_condition`: one row per SCV per condition, sets expanded, so "SCVs about condition X" is a single lookup;
- `scv.condition_ids` and `scv.condition_unspecified`: the same expansion inline, plus whether every condition is a placeholder ("not provided", "not specified"), for cheap same-condition checks;
- `condition.placeholder`: flags the placeholder traits.

### Vocabularies are tables

Upstream carries classification terms, review statuses and submission levels as free text. Derived adds seeded lookup tables, so the app agrees with ClinGen's BigQuery tooling:
- **`classification_type`:** lane, label, and whether the type can conflict (only PATH and ONCO can).
- **`classification_term`:** a short term code (`p`, `lp`, `vus-h`, `b`), significance (2, 1, 0) and bucket (P, V, B, O, N). Each SCV's `term` is matched at load. An unknown term loads with `term` NULL and is listed in `reference_issue`.
- **`review_status`:** rank and stars. Upstream has no star field (roadmap #99).
- **`submission_level`:** rank, to order PG > EP > CP > NOCP.

### What's left out

- **`data`,** each row's full GA4GH JSON. It's the bulk of upstream's bytes, and every field the derived tables use is in the typed columns. Showing or exporting a record as GA4GH JSON still needs it; how is an open question ([source-schema.md](source-schema.md#what-to-do-with-data)).
- **Upstream type and boilerplate fields,** such as `type`, `conceptType` and GA4GH `Contribution` types, where they're constant for a table.
- **Fields no page uses yet,** for example `sequenceReference.residue_alphabet` and the extension-level details of a submitted condition's MedGen match beyond its resolution and mapping.

Nothing is dropped from the downloaded files: `data/source/<release>/` keeps the full upstream parquet beside the derived tables.

### Sorted, compressed, declared

- **Sorted:** `scv` and the child tables by `variation_id`, locations by sequence and position, `scv_classification_pair` by side A's submitter then variant. DuckDB's per-block min/max statistics then skip most of a table for a lookup, without an index. Upstream files are in no particular order.
- **ZSTD** instead of SNAPPY.
- **Relationships declared:** `schema.sql` has a `REFERENCES` clause for each one. The load doesn't enforce them, so upstream's data loads as published. Instead, a generated anti-join checks each one after the load, and every dangling value goes in `reference_issue`. In 2026-10-18 there's one: 31 SCVs name 3 NCBI genes missing from upstream's `gene` table.

### Precomputed pairs

`scv_classification_pair` is the one table that stores a result rather than reshaping a source. Conflict pages compare every SCV with the others on the same variant. Rebuilding those pairs per request was the slowest work in the app, repeated several times per page. Storing them once per release (15.3M rows, 164 MB) cut Labcorp's conflict scorecard from 0.46 s to 0.13 s. [data.md](data.md#derived-model) has the rule for adding more tables like it.

## Where to look

- **Upstream columns:** [research/clinvar-gkm-parquet-describe.txt](research/clinvar-gkm-parquet-describe.txt), and upstream's `docs/parquet/tables.md`.
- **Derived DDL:** `packages/derive/sql/schema.sql`.
- **The conversion:** `packages/derive/sql/load.sql`. Build it with `scripts/derive.sh`; query the result with `scripts/sql.sh`.
- **Post-load checks:** `packages/derive/sql/validate.sql` and `packages/derive/reference-checks.awk`.
