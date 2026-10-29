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

Two stores, each holding every release once:
- **Upstream's records** as a log of changes: what each release added, changed and deleted.
- **Our derived tables** with history built in: the current rows, plus the rows later releases replaced, each marked with the releases it held.

The app reads the derived tables. The log is what they're built from, and what rebuilds them after a schema change.

A full copy per release is ruled out: a year of weekly releases would be 52 copies of about 2 GB.

### Upstream's records: a log

One table per bundle section, in the parquet shape `load.sql` reads (the converter's output), plus two columns:
- `release`: the release the row came from;
- `deleted`: true for a deletion marker, which has only the key.

The rows come from:
- **The base:** every record of the starting release, from a full JSON bundle or a parquet set.
- **One batch per delta:** the delta's added and updated records, and a marker for each deleted key.

Rows are only ever appended. The state as of release `:r` is each key's newest row up to `:r`, unless that row is a deletion:

```sql
SELECT * FROM scv_log
WHERE release <= :r
QUALIFY row_number() OVER (PARTITION BY id ORDER BY release DESC) = 1
  AND NOT deleted
```

- **A record no later release touched** has no newer row, so its row from the base (or an earlier batch) is still its state.
- **A deleted record** has a marker as its newest row from that release on, so it drops out. Earlier releases still see it.
- **A record that comes back** gets a newer row in the batch it returns in.
- **A new version of a statement** is a new key, and the old key's deletion. So "the latest version as of `:r`" needs no special handling.
- **One record's changes** are its rows, filtered by key.

The converted base is about 3 GB (3.1 GB for 2026-10-18), and each batch adds roughly the size of its delta.

### Derived tables with history

Every derived table the app reads gains `valid_from` and `valid_to`:
- `valid_from` is the first release with that row (inclusive);
- `valid_to` is the first release without it (exclusive; NULL while current).

The key of a history row is the table's natural key plus `valid_from`, e.g. `(scv_id, valid_from)`.

- **Current state:** `valid_to IS NULL`. Today's pages read only these rows.
- **As of release `:r`:** `valid_from <= :r AND (valid_to IS NULL OR valid_to > :r)`. `:r` is always a release in `history_release`; a date between releases snaps to the latest release on or before it.

That is a plain filter, with no grouping or window function per query. Most queries get it in one place, the shared compiler (`resources.ts`, `summary.ts`); the one-off queries in each `queries.ts` need it individually.

For a release R, rows only change in these ways:

| Change | Rows |
| --- | --- |
| Changed content (same key) | close the old row (`valid_to = R`); add the new one (`valid_from = R`) |
| New key (including a new statement version) | add a row from R |
| Gone | close the row; add nothing |
| Comes back later | add a row from the release it returns in; the key `(…, valid_from)` allows gaps |

`history_release` lists every release applied: date, ordinal, source (base bundle, base parquet or delta) and the delta's checksum.

**Removals as events:** a closed row that no row continues (`NOT EXISTS` a row with the same key and `valid_from` = its `valid_to`).

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

`scripts/history.sh` does this: `init` starts a history from a converted full release, `apply` applies the next delta, and `check` is the development check below. The layout, under `data/history/<schema version>/`:
- `log/<table>/release=<date>/data.parquet`: each release's records for one of `load.sql`'s 22 input tables, with `log_deleted` markers;
- `derived/<table>.parquet`: the derived tables, the history tables with `valid_from` and `valid_to`. The vocabularies and `reference_issue` are copied from the starting release as they are;
- `history_release.parquet`: the releases applied, with each one's origin, file and checksum.

Each delta is applied to the derived tables directly, re-deriving only what it touches:

1. **Check the chain:** the delta's `baseline_release` must be the last release applied.
2. **Convert and append** the delta's records and deletion markers to the log. A key deleted and re-added in the same delta keeps only its record.
3. **Collect the affected variants:**
   - variations changed or deleted;
   - the old and new subjects of changed propositions;
   - the variants of changed or deleted SCV, VCV and RCV statements and evidence lines (a VCV's accession is its variation ID);
   - the variants of SCVs whose condition set's expansion changed: a changed set, or a set naming a changed set or a condition that was added, deleted, or became or stopped being a placeholder.

   Old variants come from the history's current rows, or the log as of the previous release.
4. **Re-derive those variants:** the log's state as of R, limited to their records (unchanged ones included), plus the whole of the small lookups the load joins to (`condition`, `conditionSet`, `submitter`, `gene`) and the delta's own genome records. `load.sql` and `validate.sql` run on it unchanged.
5. **Compare** the result with the current rows, by a hash of every column (no derived table has two identical rows), and close and add rows as in the table above:
   - tables grouped by variant: the affected variants' rows;
   - lookups (`gene`, `submitter`, `condition`, `conditionSet`, `allele`, `location`, `sequenceReference`, the copy-number tables): the delta's keys, since each row is one upstream record.

Nearly every derived table is grouped by variant (`variant`, `variant_*`, `scv`, `scv_condition`, the statements, the pairs), which is what makes step 4 possible.

**A record can change what it points to under the same key.** In the 2026-10-24 delta, ClinVar deleted variant 4897201 and moved its SCV 7709478 to variant 13572. The SCV record didn't change; its proposition kept its key (`SCV007709478-PATH`) and changed subject. The delta said so plainly (the proposition as an updated record, the variation among the deleted keys), and step 3 already counted both variants as affected. The first version of step 4 didn't: it filtered the log's rows by subject before choosing each key's newest row, and so assumed a record's subject never changes. Step 4 now makes no such assumption for any table. Every selection takes the keys whose rows ever matched, resolves each key as of R, then applies the condition. 1 of the 4,166 propositions in the 2026-10-24 delta moved this way, and no statement changed its proposition.

**The risk is step 3's list.** A dependency missed there leaves stale rows. The development checks below compare every applied release with a full derivation, which is how a missed dependency shows up.

**Measured 29 October 2026**, starting from 2026-10-18 (converted from our parquet copy) and applying the 2026-10-24 delta, on the development Mac:

| Step | Time | Notes |
| --- | --- | --- |
| `init` | 4.4 min | derive (2.7 min), then write the log (3.1 GB) and derived tables (1.9 GB) |
| `apply` 2026-10-24 | 130 s | 11,178 affected variants; most of the time is rewriting the derived tables |
| `check` as of 2026-10-24 | 9.5 min | the full state from the log, a full derivation, and a comparison of every table |

The check found the history equal to a full derivation in all 18 tables, as of 2026-10-24 and, on a 12,000-variant sample, as of 2026-10-18 too.

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

The derived tables stayed at 1.9 GB.

**Releases from now on** can be applied from the week's delta, or derived from the week's parquet set and compared in full. Either way the log gains the release's changes.

**After a schema change,** the derived history is rebuilt from the log: derive the base, then apply each release in turn.

## Backfill

Start from the 2026-07 monthly (built from 2026-06-27) and apply the 17 deltas after it, through 2026-10-24 (decided 29 October 2026). Four months of weekly changes show how time and storage scale; starting from our 2026-10-18 parquet would give one delta.

That's a 4.6 GB download plus 415 MB of deltas. Ask before downloading and running it. `scripts/backfill-history.sh 2026-07` does it all: it downloads the monthly and each delta from the line index (checking their sha256, and keeping them under `data/gkm-json/`), starts the history from the monthly, and applies the deltas in order. `CHECK=1` also checks every release against a full derivation.

Upstream's known-issues page reports an allele mismatch between 2026-08-22 and 2026-08-29 in 1.0.1, fixed in 1.1.0. Its own delta-reconstruction check finds no difference on every section for all 16 consecutive pairs.

## Checks during development

These verify the approach. They aren't part of the product: a user's install only applies deltas.

- **Upstream's records:** when the replayed state reaches a release we have in full, it should equal that release. We have 2026-10-18 (our parquet copy) and 2026-10-24 (the current parquet set). The October weekly fulls and the later monthlies are further checkpoints if needed.
- **Derived tables:** after each release is applied, the current rows should equal a full derivation of the same state.
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

## Steps

1. This doc. Revised 29 October.
2. **The converter:** the columns above, and a reader for bundles and deltas, one record per line. Done, re-checked against all of 2026-10-18 on 29 October.
3. **Schema:** drop `scv.vcv_statement_id` and `scv.rcv_statement_id`, add `scv.tier` and `scv.rcv_accession`, and move the two queries that use them to the column join. Done 29 October; `validate.sql` checks the join against the evidence lines every load.
4. **The log, derived history and applying a release** (`scripts/history.sh`). Done 29 October, checked on 2026-10-18 plus the 2026-10-24 delta, in full and on a sample.
5. **Backfill** from the 2026-07 monthly, with the development checks, measuring time and growth per release.
6. **API:** the as-of filter in the compiler and the one-off queries; a variant's versions and removals.
7. **Web:** a history view on the variant page that renders a past version with its SCVs as they stood.

## Open questions

1. **Which columns count as a change.** Every column (the hash) is simplest, and catches the MedGen re-mappings. The rows keep every change; a timeline could show only version and classification changes.
2. **How derived history is laid out on disk.** Closing a row rewrites its file. Either one file per table with both current and closed rows, or current rows and closed rows in separate files, so current-state queries read exactly what they read today. To measure in the backfill.
3. **What "as of a date" covers in the app.** First a record's history (step 7). The whole app at a past date (search, gene pages, conflicts) is the same filter on every query, so it stays possible.
4. **Where history lives for a local install:** shipped built, or built by each install from the log.
5. **Earlier history** from NCBI's tab-delimited archives, back to 2014 ([data.md](data.md#history)).
