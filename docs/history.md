# ClinVar GKM browser: history

Status: draft, 29 October 2026, on the `history` branch (first written 26 October; the model was revised on 29 October). How the app stores ClinVar's past releases and shows a record as it was. [data.md](data.md#history) has the earlier outline; this doc replaces its model.

## What the source has

As of 29 October 2026, ClinVar-GKM covers 18 ClinVar releases, 2026-06-27 to 2026-10-24, all in its current 1.1 format. Upstream rewrote every past release when it moved from 1.0 (its ADR 0006), so the frozen `v1/1.0` files aren't needed.

- **Monthly full bundles** (JSON, about 4.6 GB gzipped), each built from one weekly release:

  | Monthly | Built from |
  | --- | --- |
  | 2026-07 | 2026-06-27 |
  | 2026-08 | 2026-08-04 |
  | 2026-09 | 2026-08-29 |
  | 2026-10 | 2026-09-28 |

- **Weekly full bundles** for the current month only.
- **A weekly delta** (JSON) for every release after 2026-06-27: 17 so far, 1–152 MB each, 415 MB in all. A delta holds the full records that were added or changed, in the same sections as a full bundle, each keyed by ID. Its manifest counts the added and updated records per section, lists the deleted keys, and names the release it applies to (`baseline_release`). A deleted record is listed by key only, so a delta can be applied forwards but not undone.
- **One parquet set,** for the latest release only (13.2 GB), overwritten every week. There are no parquet deltas, and none in the archives. Upstream decided this deliberately: parquet is "derived from the bundle; may be regenerated" (its ADR 0008 (e), amended by ADR 0009, 20–21 October 2026). Its planned tool, clingen-data-model/clinvar-gkm-parquet, will rebuild parquet for any past week from a monthly plus deltas. The tool was at v0 and unreleased as of 23 October.
- **One record per line.** Upstream's assembler writes each record of a bundle or delta on its own line, so a 4.6 GB bundle can be read line by line. Upstream calls this an implementation detail, not a guarantee (the tool's design plan, D4).
- **Statement IDs carry their version** (`VCV000000745.22-G-PATH`, `clinvar.submission:SCV000024273.152`). A new version appears in a delta as the new ID added and the old one deleted.
- **Nothing before 2026-06-27** is in ClinVar-GKM. Earlier history needs another source ([data.md](data.md#history)).

**We convert the JSON deltas ourselves** (decided 29 October 2026), with the converter below, rather than wait for upstream to publish parquet deltas or release its tool. If the tool ships and matches the published parquet, it could replace our converter.

## How ClinVar versions records

ClinVar's [identifiers documentation](https://www.ncbi.nlm.nih.gov/clinvar/docs/identifiers/) says an SCV's version goes up when its submitter updates it, even if only the submission date changes. A VCV's or RCV's version goes up when its content changes "because of addition to, updates of, or deletion of the SCV accessions on which it is based". Staff edits (rs numbers, HGVS) change no version.

The 2026-10-18 delta agrees. Measured 26 October 2026, against the 2026-10-11 delta for earlier versions:
- **Every SCV version bump bumped its VCV** (1,966 of 1,966).
- **Nearly every VCV bump has an SCV change under it.** Of the 5,366 bumps, 5,362 have a new or re-versioned SCV and 3 have an SCV whose content changed without a new version. That leaves 1, probably a removed SCV (13 were removed that week).
- **The aggregate call usually stays the same.** Of the 43 bumped VCVs whose previous version was visible, 39 kept their classification (e.g. VCV000000745 version 21 to 22, Pathogenic).
- **One version per weekly release:** every bump was +1.
- **ClinVar-GKM also changes SCV content without a new version:** 5,839 SCVs that week, only about 1% of them under a bumped VCV. In the 3 we could compare, a submitted condition's MedGen mapping changed. So SCV versions alone don't capture every change to a page.

Each VCV version lists exactly which SCV versions it cites, in its evidence lines (`VCV….41-G-PATH-CP.contributing` → `SCV000024273.152`). "The SCVs as of VCV version N" is therefore a lookup, not an inference from dates.

## Model

Two stores, each holding every release once (revised 29 October 2026, after a review of the first version):
- **Upstream's records, as published:** the log. It doesn't depend on our schema, so it can rebuild the derived history after any schema change, including one that reads a field `load.sql` doesn't read today.
- **Our derived tables with history:** what the app reads.

A full copy per release is ruled out: a year of weekly releases would be 52 copies of about 2 GB.

Both stores have one layout, and no file is ever rewritten:

```
<store>/added/<table>/release=<date>/data.parquet    rows the release added
<store>/closed/<table>/release=<date>/data.parquet   rows it closed
<store>/releases.parquet                             the releases in the store, in order
```

A row holds from the release that added it (`valid_from`) until the release that closed it (`valid_to`), if any. Applying a release writes two small files per table. A release counts once it's listed in `releases.parquet`, which is written last, so a run that stops partway leaves files the next run clears.

As of release `:r`, for the derived `scv` (the log is the same, by `key`):

```sql
SELECT a.* FROM added a
ANTI JOIN closed c ON c.scv_id = a.scv_id AND c.valid_from = a.release AND c.release <= :r
WHERE a.release <= :r
```

- **A record no later release touched** was never closed, so its row from the base (or an earlier release) still holds.
- **A deleted record** is closed with nothing added after it. It drops out from that release on, and earlier releases still see it.
- **A record that comes back** gets a new row in the release it returns in.
- **A new version of a statement** is a new key, and the old key closed. So "the latest version as of `:r`" needs no special handling.
- **One record's history** is its rows by key, with `valid_to` from the closings.

Every row carries its own validity, so a filter on any column reads the version that holds at `:r`. The first version kept the log as an append-only list of changes plus deletion markers, where "as of" meant each key's newest row. There, a filter applied before choosing the newest row could find a stale one (see "A record can change what it points to" below), and every selection had to resolve keys first.

### The log

`data/history/log/`, outside the schema version: one table per bundle section, rows `(key, rec)` with the record's JSON as published. It also holds the pointers the tracing follows (a proposition's subject, a statement's proposition, an evidence line's statement and target), taken from the record when it's written. A closed row is named by `(key, valid_from)`. Records are converted to `load.sql`'s input (`from-state.sql`) when they're read. 2026-10-18 is 4.2 GB.

### Derived tables with history

`data/history/<schema version>/`: the tables grouped by variant (`variant`, `variant_gene`, `variant_hgvs`, `variant_xref`, `vcv_statement`, `rcv_statement`, `scv`, `scv_condition`, `scv_classification_pair`), and the lookups (`gene`, `submitter`, `condition`, `conditionSet`, `allele`, `location`, `sequenceReference`, the copy-number tables).

A closed row is named by its table's natural key and `valid_from`. Each key is unique among the rows holding at any one release (checked on 2026-10-18):

| Table | Natural key |
| --- | --- |
| `variant` | `variation_id` |
| `variant_gene` | `variation_id`, `gene_id` |
| `variant_hgvs` | `variation_id`, `ordinal` |
| `variant_xref` | `variation_id`, `system`, `code` |
| `vcv_statement`, `rcv_statement` | `statement_id` |
| `scv` | `scv_id` |
| `scv_condition` | `scv_id`, `condition_id` |
| `scv_classification_pair` | `a_scv_id`, `b_scv_id` |
| lookups | `id` |

Storing a hash of each row instead would have cost 1 GB (2.9 GB against 1.9 GB).

The vocabularies are copied from `schema.sql`'s seed. `reference_issue` is left out: it describes one derivation, and `check` derives it in full.

For a release R, rows only change in these ways:

| Change | Rows |
| --- | --- |
| Changed content (same key) | close the old row (`valid_to = R`); add the new one (`valid_from = R`) |
| New key (including a new statement version) | add a row from R |
| Gone | close the row; add nothing |
| Comes back later | add a row from the release it returns in; the key `(…, valid_from)` allows gaps |

**Removals as events:** a closed row that no row continues (no row with the same key and `valid_from` equal to its `valid_to`).

**Prior art:** ClinGen's clinvar-ingest-bq-tools keeps the same kind of table in BigQuery (`scripts/temporal-data-collection/`, e.g. `clinvar_ingest.clinvar_scvs`, read 29 October 2026). Each row has `start_release_date`, `end_release_date` and `deleted_release_date`, and "as of" is `release_date BETWEEN start_release_date AND end_release_date`. It differs from this design in three ways:
- **Its end date is the last release a row was seen in,** so every unchanged row is updated each release to extend it. An open `valid_to` touches only the rows that changed.
- **A deletion is a third date** rather than a closed row with no successor.
- **Only some columns start a new row.** For SCVs: the version, statement type, rank, proposition type, the two clinical-impact columns, date last evaluated, significance, RCV accession and trait set. A change to the others (submitter name, PMIDs, review status, comment) overwrites the current row, so their history is lost. This design keeps every change (open question 1).

Its SCV rows carry the RCV accession without its version, as `scv.rcv_accession` will here.

**Viewing VCV version N** (as of `:r`, a release inside N's interval; by default the release N first appeared in) is a lookup on the statement's evidence lines and the SCVs as of `:r`.

### Rows that change when their record didn't

A derived row should change only when something it shows changed. Otherwise history fills with copies of unchanged rows.

- **The SCV's links to its VCV and RCV statements are dropped from `scv`** (decided 29 October 2026). `scv.vcv_statement_id` carried the VCV's version (`VCV000000010.141-G-PATH-CP`), and ClinVar bumps that version whenever any SCV under it changes. So one lab's update would give every other SCV on the variant a new row. Upstream doesn't link an SCV to its statement at all: the VCV's evidence lines cite the SCV, and `load.sql` reversed that link. The statement is instead found by the columns the SCV already has:
  - VCV: `variation_id`, `classification_type` and `submission_level`, plus the tier for somatic clinical impact (`'T' || n` from `classification_code` 'tier n');
  - RCV: `scv.rcv_accession` (unversioned, as in `rcv_statement.rcv_accession`), with the same three.

  On 2026-10-18 this join reproduces both stored links for all 6,853,781 SCVs, with no SCV matching two statements.
- **`variant.vcv_version`** changes with every VCV bump. It's the variant's own record changing, at one row per variant, so it stays.
- **`scv_classification_pair`** has a row for every pair of SCVs on a variant, so a changed SCV changes all its pairs. That's intrinsic. The backfill will measure how much it grows.

## Applying a release

`scripts/history.sh` does this:
- `init <state>` starts both stores from a full release's state;
- `apply <delta state>` adds a weekly delta to the log, then to the derived history;
- `rebuild` re-derives the history from the log, e.g. after a schema change;
- `check [release]` is the development check below.

The derived history reads each release's changes from the log, so `apply` and `rebuild` take the same path.

1. **Check the delta:** its `baseline_release` must be the log's last release, and its ClinVar-GKM `schema_version` the log's. A new format needs a new log, since upstream rewrites every past release when it moves.
2. **The log:** per section, a delta record that differs from (or is missing in) the previous release is added and its old row closed, and a deleted key is closed. A record re-sent unchanged is ignored, and one deleted and re-added in the same delta is an update.
3. **Find the affected variants** from the log's changes in R:
   - variations changed or deleted;
   - the old and new subjects of changed propositions, and of the propositions of changed statements, or of statements whose evidence lines changed;
   - SCVs using a condition set whose expansion changed: a changed set, or any set naming it, at any depth;
   - SCVs naming a changed condition, directly or through a set (`scv_condition` holds the expansion). Any change to the condition counts, rather than repeating `load.sql`'s placeholder rule. Extra variants cost little, since their rows hash equal and stay open.

   There is one path however many variants a release touches. The worst case is a change to the "not provided" condition, which 1.9M SCVs name. Measured with a synthetic delta that changed only that condition, on the full 2026-10-18 history: 1,514,869 variants affected, and the apply took 210 s. That breaks down as 40 s gathering their records, 2.6 min deriving them and 11 s comparing, which is faster than a full re-derive (about 6.5 min). An earlier version switched to a full re-derive past 10% of the variants; it was dropped as a second path for no measured gain.
4. **Re-derive them:** their records as of R (unchanged ones included), the small lookups the load joins to (`condition`, `conditionSet`, `submitter`, `gene`) whole, and the release's genome records. These are converted, and `load.sql` and `validate.sql` run on them unchanged.
5. **Compare** with the current rows, by a hash of every column computed during the apply. Then write the added rows and the closings:
   - tables grouped by variant: the affected variants' rows;
   - lookups: the release's keys, since each row is one upstream record.

**A record can change what it points to under the same key.** In the 2026-10-24 delta, ClinVar deleted variant 4897201 and moved its SCV 7709478 to variant 13572. The SCV record didn't change; its proposition kept its key (`SCV007709478-PATH`) and changed subject. The delta said so plainly (the proposition as an updated record, the variation among the deleted keys), and step 3 counts both variants as affected. 1 of the 4,166 propositions in that delta moved this way, and no statement changed its proposition. With each log row carrying its validity, selecting a variant's propositions by subject reads the version that holds at R, so a proposition that moved away in an earlier release isn't found on its old variant.

**The risk is step 3's list.** A dependency missed there leaves stale rows. `pnpm test:history` covers each kind of dependency (below), and the development check compares any release with a full derivation.

**Measured 29 October 2026**, starting from 2026-10-18 (its state from our parquet copy) and applying the 2026-10-24 delta, on the development Mac:

| Step | Time | Notes |
| --- | --- | --- |
| `init` | 8.3 min | write the log (4.2 GB), then convert (3.7 min) and derive (2.7 min) |
| `apply` 2026-10-24 | 34 s | the log 11 s; 11,467 affected variants re-derived and compared in 23 s |
| `check` as of 2026-10-24 | 11.6 min | the full state from the log, converted and derived, and every table compared |

The check found the history equal to a full derivation in all 18 tables. The derived history stayed at 1.9 GB.

The first version (a converted log, deletion markers, and each derived table rewritten every release) applied the same delta in 130 s.

Rows closed and added by the 2026-10-24 delta, for scale:

| Table | Closed | Added |
| --- | --- | --- |
| `variant` | 1,767 | 2,157 |
| `variant_hgvs` | 44,008 | 48,826 |
| `vcv_statement` | 2,080 | 3,304 |
| `rcv_statement` | 1,318 | 2,718 |
| `scv` | 2,633 | 3,403 |
| `scv_classification_pair` | 700 | 3,646 |
| `allele` | 1 | 368 |
| `conditionSet` | 23 | 61 |

**Releases from now on** can be applied from the week's delta, or derived from the week's parquet set and compared in full. Either way the log gains the release's changes.

## Backfill

Start from the 2026-07 monthly (built from 2026-06-27) and apply the 17 deltas after it, through 2026-10-24 (decided 29 October 2026). Four months of weekly changes show how time and storage scale; starting from our 2026-10-18 parquet would give one delta.

That's a 4.6 GB download plus 415 MB of deltas. Ask before downloading and running it. `scripts/backfill-history.sh 2026-07` does it all: it downloads the monthly and each delta from the line index (checking their sha256, and keeping them under `data/gkm-json/`), starts the history from the monthly, and applies the deltas in order. `CHECK=1` also checks every release against a full derivation.

Upstream's known-issues page reports an allele mismatch between 2026-08-22 and 2026-08-29 in 1.0.1, fixed in 1.1.0. Its own delta-reconstruction check finds no difference on every section for all 16 consecutive pairs.

**Run 29–30 October 2026**, on the development Mac. The history now holds 2026-06-27 to 2026-10-24, 18 releases.
- **Reading the monthly** (4.5 GB gzipped, 63 GB of JSON) took about 25 minutes. The line-by-line split is single-threaded, so it dominates.
- **Starting the history from it** took about 8 minutes.
- **The 17 deltas** took 11 minutes in all: 20 to 95 s each, roughly in proportion to the variants touched (6,405 to 327,313).

| Release | Variants affected | Apply |
| --- | --- | --- |
| 2026-07-06 | 109,487 | 36 s |
| 2026-07-27 | 176,550 | 56 s |
| 2026-08-22 | 6,405 | 21 s |
| 2026-09-23 | 327,313 | 95 s |
| 2026-09-28 | 171,307 | 80 s |
| 2026-10-24 | 11,467 | 31 s |

The first run stopped at 2026-09-28, out of memory converting its affected variants' records (see "Large records convert in batches" below). It resumed from the log, with the monthly not read again.

**Growth over the 17 weeks:** 9.9% more rows across the derived tables, about 0.6% a week. The derived history went from 1.9 to 2.0 GB, and the log is 4.4 GB.

| Table | Base rows | Added | Closed | Growth |
| --- | --- | --- | --- | --- |
| `scv_classification_pair` | 12,948,490 | 3,650,084 | 1,317,368 | 28.2% |
| `variant_hgvs` | 41,733,510 | 2,387,916 | 674,243 | 5.7% |
| `vcv_statement` | 8,841,570 | 1,561,269 | 1,235,964 | 17.7% |
| `rcv_statement` | 11,298,814 | 1,455,339 | 696,398 | 12.9% |
| `variant` | 4,531,457 | 831,463 | 670,703 | 18.3% |
| `scv` | 6,374,753 | 700,674 | 220,876 | 11.0% |
| `scv_condition` | 6,848,453 | 503,817 | 14,633 | 7.4% |
| `conditionSet` | 81,431 | 31,610 | 12,297 | 38.8% |

82% of the closed `variant_hgvs` rows (551,640 of 674,243) were position shifts only: the same content was added back at another ordinal in the same release (open question 2).

**Checks after the backfill:**
- **Derived:** as of 2026-10-24, the derived history equals a full derivation of the log's state in all 18 tables.
- **Upstream's records:** as of 2026-10-18, the log equals the state built from our 2026-10-18 parquet copy in 13 of 20 sections, record for record.
  - In the other seven the records differ as text, because the monthly bundle and the parquet export order JSON keys differently.
  - Compared as parsed JSON (a 30,000-record sample per section, all of `condition`), every record is equal apart from the order of lists. These are 1,675 conditions' `aliases` and one variation's processing messages. Upstream's change log ignores array order, so it never sends these as changes, and the log keeps the bundle's order.
- **A record read straight from the history files:** a variant's SCVs as of 2026-10-24 take about 55 ms, the same as from one derived release (DuckDB CLI).

## Checks during development

These verify the approach. They aren't part of the product: a user's install only applies deltas.

- **Upstream's records:** when the replayed state reaches a release we have in full, it should equal that release. We have 2026-10-18 (our parquet copy) and 2026-10-24 (the current parquet set). The October weekly fulls and the later monthlies are further checkpoints if needed.
- **Derived tables:** after each release is applied, the current rows should equal a full derivation of the same state (`history.sh check`).
- **`pnpm test:history`** (`scripts/test-history.sh`, about a minute) runs `history.sh` on a committed fixture, `packages/derive/test/history/`. The fixture is 148 records of four variants from 2026-10-18 and the real 2026-10-24 delta cut to them (`scripts/make-history-fixture.sh`). Two synthetic deltas follow, built from the base records. Together they cover:
  - a proposition moving to another variant;
  - a variation, VCV and RCV deleted;
  - a changed condition, and one becoming a placeholder;
  - a set gaining a member set, then a change reaching an SCV only through that nesting;
  - an SCV deleted and re-added in one delta;
  - an SCV removed with its evidence-line citations;
  - a VCV version bump.

  After each delta, the history must equal a full derivation. The test also resumes an interrupted run and rebuilds from the log. With the set tracing removed, it fails at the nested-set delta.
- **One known gap:** a condition set that shrinks to one member. Upstream drops single-member sets from its export, so the set is neither in the delta nor in its deleted keys. The replayed state keeps the old row. Expected to be rare; the first check will show whether it happens.

## The converter

`packages/derive/sql/from-state.sql`, run by `scripts/convert-state.sh`, turns a release's **state** into upstream's parquet shape, so `load.sql` runs on it unchanged. A state is one file per bundle section, rows `(key, rec)`, with `rec` the record's JSON as in the bundle. A delta's records are a state too, just a small one.

The converter follows upstream's own export (clinvar-gkm `src/scripts/parquet-schemas/`):
- `#/<section>/` pointers become bare ids;
- extension values are split into `value_<type>` fields by extension name;
- absent lists are `[]` and absent objects NULL, as in BigQuery's output;
- the bundle's one `evidenceLine` section becomes the VCV, RCV and SCV evidence-line tables.

It writes only the columns `load.sql` reads.

**Checked 26 October 2026 against all of 2026-10-18,** without the 4.6 GB bundle. The published parquet's `data` column holds the bundle's records: 1,269 records sampled from the 2026-10-18 delta were identical to their `data`. So a state built from `data` (`scripts/state-from-parquet.sh`) is the bundle's state. `scripts/check-converter.sh` then compares:
- **columns:** all 22 converted tables equal the published typed columns, every row. About 11 minutes, mostly `variation`;
- **derived:** the converted release, derived, equals `data/derived/1/2026-10-18` in all 30 tables compared (all but `release` and `source_file`, which describe the input files). About a minute.

**Re-checked 29 October 2026 after the schema change** ([schema.md](schema.md#shape)), which made `load.sql` read more columns. The converter now also writes:
- `iris` on a condition's codings;
- a citation's `type` and `extensions`;
- a submitted condition's `conditionSet`, `condition`, `xrefs`, `original_medgen_match` and `direct_match`;
- a submitted condition set's `conditionSet`, `condition` and `multiple_condition_explanation`.

All 22 converted tables equal the published columns, and all 23 derived tables compared equal `data/derived/1/2026-10-18`.

Costs on the development Mac, 29 October:

| Step | Time | Peak memory | Output |
| --- | --- | --- | --- |
| State from parquet | 33 s | | 3.8 GB |
| Convert | 3.7 min | 4.6 GB resident (26 October) | 3.1 GB |
| Check columns | 15 min | | |
| Derive | 2.7 min | as before | 1.9 GB |
| Check derived | 67 s | | |

**Reading a bundle** (`scripts/state-from-bundle.sh`): the assembler writes one record per line inside one block per section, so a strict line-by-line pass splits a bundle into a state, and fails on any line that doesn't fit. With `--delta` it also writes the manifest's deleted keys (`deleted.parquet`, section and key). It checks each section's record count against the manifest's added plus updated, except `conditionSet`: the manifest counts every changed set, but the bundle leaves out single-member sets (61 records against 66 in the 2026-10-24 delta). The 2026-10-24 delta (6.7 MB) reads in 6 s and converts in 3 s.

Large records (up to 0.5 MB of JSON, and a variation's nested HGVS list) ran out of DuckDB's 4 GB limit at first. Both steps now use 3 threads, 20,000-row groups and a spill directory.

**Large records convert in batches** (30 October 2026). DuckDB converts 2,048 records at a time, and a large variation record expands into many nested values. A whole release has 14,865 records over 100 KB (1.8 GB of JSON), spread among 91 million. But the variants a big week touches cluster them: the backfill's 2026-09-28 apply gathered 169,039 variations, 7,779 of them over 100 KB (939 MB). Converting those ran out of memory even on one thread.

So `convert-state.sh` converts records over 50 KB separately, in batches of at most 32 MB of JSON, and checks that every record becomes exactly one row. The 200 largest records of 2026-10-18 together peak at 1.2 GB. The 2026-09-28 subset now converts in 41 s. Once converted, the load reads such clusters without trouble: `load.sql`'s HGVS step over all 7,779 rows (2.9M HGVS rows) peaks at 2.3 GB.

## Steps

1. This doc. Revised 29 October.
2. **The converter:** the columns above, and a reader for bundles and deltas, one record per line. Done, re-checked against all of 2026-10-18 on 29 October.
3. **Schema:** drop `scv.vcv_statement_id` and `scv.rcv_statement_id`, add `scv.tier` and `scv.rcv_accession`, and move the two queries that use them to the column join. Done 29 October; `validate.sql` checks the join against the evidence lines every load.
4. **The log, derived history and applying a release** (`scripts/history.sh`). Done 29 October and revised the same day after a review: the log holds raw records and doesn't depend on our schema, both stores keep immutable files with a closings table, and the derived history adds `rebuild` and a test (`pnpm test:history`). Checked on 2026-10-18 plus the 2026-10-24 delta.
5. **Backfill** from the 2026-07 monthly, with the development checks, measuring time and growth per release. Done 30 October: 2026-06-27 to 2026-10-24.
6. **API:** a `release` parameter on every request meaning "as of this release" (a date between releases uses the latest release on or before it), applied by the shared compiler and each one-off query; the releases available; a variant's VCV versions and an SCV's versions, each with the releases it held.
7. **Web:** see "In the app" below.

## In the app

Decided 29 October 2026:
- **One mechanism, the release.**
  - **The header** lists the releases available and can rewind the whole browser to one. Every page and query then reads the data as of that release, through the `release` URL parameter.
  - **The variant page** lists the variant's VCV versions. Each links to the page as of the release that version first appeared in, so viewing VCV version N is the same rewind, not a separate feature.
  - **The SCV tables** can show an SCV's past versions, each with the releases it held. They also show the VCV versions it was part of: the variant's VCV rows that held at the same time, each linking to the variant as of its release.
- **The app reads the derived history's files directly** if that's fast enough on the variant page's queries. Otherwise it also writes a file of the current rows each week. To measure after the backfill.
- **A local install** starts from a history shipped in the image (releases A to B) and can check for and apply upstream's deltas after B (`history.sh apply`, as the backfill does). If the history downloads quickly enough, it can be fetched at startup instead of shipped.

## Open questions

1. **Which columns count as a change.** Every column (the hash) is simplest, and catches the MedGen re-mappings. The rows keep every change; a timeline could show only version and classification changes.
2. **HGVS ordinals.** Most of `variant_hgvs`'s churn is expressions shifting position after an insertion: 82% of its closed rows over the backfill's 17 weeks. Comparing these rows by content, and keeping today's order for past views, would cut that. To decide from the backfill's growth.
3. **Shipping the history in the image or downloading it at startup,** to decide from its size after the backfill.
4. **Earlier history** from NCBI's tab-delimited archives, back to 2014 ([data.md](data.md#history)).
