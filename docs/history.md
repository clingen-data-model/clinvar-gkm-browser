# ClinVar GKM browser: history

Status: draft, 26 October 2026, on the `history` branch. How the app stores ClinVar's past releases and shows a record as it was. [data.md](data.md#history) has the earlier outline; this doc replaces its model.

## What the source has

- **ClinVar-GKM's JSON covers 17 ClinVar releases,** 2026-06-27 to 2026-10-18 (as of 26 October 2026):
  - a monthly full bundle (about 4.6 GB gzipped) for 2026-06-27;
  - a weekly delta (2–75 MB) for each release after it.

  Every file is in the current 1.1 format: upstream rewrote all past releases when it moved from 1.0 (its ADR 0006). The frozen `v1/1.0` files aren't needed.
- **Parquet exists for the latest release only,** rebuilt and overwritten weekly.
- **A delta holds the full objects that were added or changed,** in the same sections as the full bundle, each keyed by ID. Its manifest counts the added and updated records per section and lists the deleted IDs. A deleted record is listed by ID only, without its content. So a delta can be applied forwards, but not undone.
- **Statement IDs carry their version** (`VCV000000745.22-G-PATH`, `clinvar.submission:SCV000024273.152`). A new version appears in a delta as the new ID added and the old one deleted.
- **Nothing before 2026-06-27** is in ClinVar-GKM. Earlier history needs another source ([data.md](data.md#history)).

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

**History tables sit beside the per-release tables; they don't replace them.** Current pages, the stored pairs and the API keep reading the latest derived release, unchanged. History tables live in their own directory and grow by one set of changes per release. Current rows appear in both, at about 400 MB for `scv`.

**Intervals of releases.** A history row is one state of a record and the releases it held:
- `valid_from` is the first release with that state (inclusive);
- `valid_to` is the first release without it (exclusive; NULL while current).

A record's state as of release `:r` is the row where `valid_from <= :r AND (valid_to IS NULL OR valid_to > :r)`. `:r` is always a release in `history_release`; a date between releases snaps to the latest release on or before it.

**Rows are only ever added or closed, never deleted or edited otherwise.** For a change in release R:

| Change | Rows |
| --- | --- |
| New version (`.2` deleted, `.3` added) | close the `.2` row (`valid_to = R`); add a `.3` row (`valid_from = R`) |
| Content change, same version | close the old state; add the new one |
| Removed | close the row; add nothing |
| Comes back later | add a row from the release it returns in; the key `(id, valid_from)` allows gaps |

**Tables (first pass):**

| Table | One row per | Notes |
| --- | --- | --- |
| `history_release` | release processed | date, ordinal, source (monthly full, delta, parquet), and whether the release before it was missing |
| `scv_history` | SCV state | `scv_state_key`, then the `scv` columns, `valid_from`, `valid_to` |
| `scv_condition_history`, `scv_citation_history`, `scv_submitted_condition_history` | child row of an SCV state | keyed by `scv_state_key`; they inherit the state's interval, so a child-only change is a new SCV state |
| `vcv_statement_history` | VCV statement version | the `vcv_statement` columns, `valid_from`, `valid_to`. A statement ID is one version, so a row closes only when the next version or a removal replaces it |
| `vcv_version_scv` | SCV version cited by a VCV version | `variation_id`, `vcv_version`, `scv_id`, `scv_version`, submission level, contributes. Written once, never closed |
| `submitter_history`, `condition_history`, `gene_history` | lookup state | past pages show the names and mappings of their release, falling back to the last known one |

Left for later: RCV statements, variant descriptions (HGVS lists, gene lists, cross-references change weekly with no version: 55k variation records in the 2026-10-18 delta), and history for the pairs table. A past variant has few enough SCVs to compare on the fly.

**Viewing VCV version N** (as of `:r`, a release inside N's interval; by default the release N first appeared in):

```sql
SELECT s.*
FROM vcv_version_scv c
JOIN scv_history s
  ON s.scv_id = c.scv_id AND s.scv_version = c.scv_version
 AND s.valid_from <= :r AND (s.valid_to IS NULL OR s.valid_to > :r)
WHERE c.variation_id = :v AND c.vcv_version = :n;
```

**Removals as events:** a closed row that no row continues (`NOT EXISTS` a row for the same ID with `valid_from` = its `valid_to`).

## Building it

**One step per release:** compare the newly derived release with the previous one, by key and by a hash of each row's columns:
- a key in both with a different hash: close the old row and add the new state;
- a new key: add it;
- a key that's gone: close its row.

The comparison is on derived tables, not on the delta's lists, because a derived row can change when its own upstream record didn't (an `scv_condition` row when its condition set changes).

**Going forward:** each weekly Parquet release is derived as now, then compared with the previous one. If a release is missed, the closing release is the first one where the change was seen, and `history_release` marks the gap.

**Backfill, 2026-06-27 to the latest release:**
1. Start from the 2026-06-27 monthly bundle.
2. For each delta in order:
   - apply it to the previous source state: replace records by ID, drop the deleted IDs;
   - convert the state to the Parquet shape `load.sql` reads;
   - derive it;
   - compare it with the previous derived release.
3. Keep only the two most recent states at any time (about 15–20 GB at peak).
4. Refuse to continue past a gap in the deltas.

About 17 derivations of 3 minutes each, once. Applying a delta to the derived tables directly would mean tracing every dependency; re-deriving the whole release can't miss one.

**The converter** turns bundle JSON into upstream's Parquet shape: typed columns, bare IDs instead of `#/section/id` pointers, no `data` column. It's checked by an oracle:
- the 2026-10-18 delta's records, converted, must equal the same IDs' rows in the published 2026-10-18 Parquet;
- later, the whole 2026-10-18 weekly bundle, converted and derived, must equal the release derived from the published Parquet.

## Steps

1. This doc. Done.
2. **The converter,** checked against the 2026-10-18 delta's records.
3. **History tables and the compare step,** tested on the fixture with a hand-made second release.
4. **Backfill** from 2026-06-27, after the full-bundle oracle passes. Ask before downloading the 4.6 GB bundle and running the backfill.
5. **API:** a variant's versions and removals; any read with `as_of`.
6. **Web:** a history selector on the variant page that renders a past version with its SCVs as they stood.

## Open questions

1. Which SCV columns count as a change. Every column (the hash) is simplest and catches the MedGen re-mappings. Too noisy for a timeline? The timeline could show only version changes and classification changes, while the rows keep everything.
2. Where history lives for a local install: shared, built once and downloaded, or each install building its own?
3. Earlier history from NCBI's tab-delimited archives, back to 2014 ([data.md](data.md#history)).
