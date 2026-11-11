# ClinVar doesn't version a VCV when an SCV is removed

Status: findings, 11 November 2026. Measured over the release history (2026-06-27 to 2026-10-31, 19 releases) and checked against ClinVar's own VCV XML for 2026-09-23 and 2026-09-28. Not yet raised with NCBI or the ClinVar-GKM team. [history.md](../history.md#how-clinvar-versions-records) records what this changes for the app.

## The question

ClinVar's [identifiers documentation](https://www.ncbi.nlm.nih.gov/clinvar/docs/identifiers/) says a VCV's version goes up when its content changes "because of addition to, updates of, or deletion of the SCV accessions on which it is based". Browsing variant 1828 as of 2026-09-23 showed Baylor Genetics' SCV000328829 removed in 2026-09-28 while the VCV stayed at version 5. Was that ClinVar, ClinVar-GKM, or our derivation?

## Findings

**Removing an SCV doesn't give its VCV a new version.** ClinVar drops the SCV from the VCV in place, under the same version, even when the aggregate classification changes as a result. The version goes up when an SCV is added or gets a new version.

**It's the usual case, not an exception.** Over the 19 releases, 9,086 SCVs were removed (an SCV key closed with no later version of the same accession added in that release). Every one was cited by a VCV's evidence lines just before. After the removal:

| VCV | Removals | VCVs |
| --- | --- | --- |
| Same version, its evidence line rewritten without the SCV | 5,900 | 5,884 |
| Same version, the evidence line citing it gone (no SCVs left at that submission level) | 3,077 | 3,071 |
| A new version | 109 | 105 |

Of the 109 with a new version, 108 also had an SCV added or re-versioned under that VCV in the same release, which accounts for the new version. The one left is below.

**Removals come in batches, one submitter at a time.** 2026-09-28 removed 7,506 SCVs, 7,469 of them Baylor Genetics'. 2026-08-04 removed 532 (3billion 510), and 2026-09-13 558 (Dasa 555). The other 15 releases after the first removed 0 to 169 each.

**ClinVar's XML shows the same, so it isn't ClinVar-GKM.** Seven VCVs cut from the 2026-09-23 and 2026-09-28 `ClinVarVCVRelease` files (`VariationArchive` elements):

| VCV | Version | Submissions | What changed |
| --- | --- | --- | --- |
| 1828 | 5 → 5 | 4 → 3 | Baylor's SCV000328829.3 removed; call unchanged (Likely pathogenic, multiple submitters, no conflicts) |
| 5 | 12 → 12 | 7 → 6 | Baylor's SCV007676679.1 removed; call unchanged (Pathogenic) |
| 762 | 3 → 3 | 2 → 1 | Baylor's SCV007678498.1 removed; call Likely pathogenic (criteria provided, single submitter) → Pathogenic (no assertion criteria provided) |
| 853 | 4 → 4 | 4 → 3 | Baylor's SCV007678525.1 removed; the same change of call as 762 |
| 576 | 161 → 162 | 42 → 42 | Baylor's SCV001163708.3 removed, and GenomeConnect's SCV007981417.1 added |
| 612 | 113 → 114 | 19 → 19 | Baylor's SCV001163710.3 removed, and SCV007984075.1 (a Xuzhou laboratory) added |
| 119 | 47 → 48 | 23 → 24 | A control: GenomeConnect's SCV007984332.1 added, nothing removed |

ClinVar's own record for variant 1828 today agrees: NCBI's E-utilities summary (`esummary.fcgi?db=clinvar&id=1828`, read 11 November 2026) gives `VCV000001828.5` with three supporting SCVs, not SCV000328829.

**`DateLastUpdated` isn't a signal either.** It moved on six of the seven (2026-09-22 → 2026-09-27), whatever changed.

## The one removal that came with a new version

VCV 559557 went from version 11 to 12 in 2026-10-18 when its only no-assertion-criteria SCV, SCV001547544.2, was removed, with nothing added. Version 12's criteria-provided evidence line cites the same three SCVs as version 11's, and the no-assertion-criteria line is gone. That is what 762 and 853 did without a new version. ClinVar-GKM's records don't show anything else that changed; the 2026-10-11 and 2026-10-18 VCV XML would.

## What it means for the app

- **A VCV version isn't one state of the record.** Its evidence lines, submission count and aggregate call can change within it. The history keeps every change whether or not a version moved, so the app shows these removals: a removed SCV's classification history ends in "none", and a changed call shows in the aggregate's field history.
- **The VCV versions list treats a version as one state,** linking each to the page as of the release it first appeared in. For 1828, "version 5" links to 2026-09-13, which still shows Baylor's SCV. The SCV page's "VCV versions it was part of" rests on the same assumption. Nothing shown is false, but a version can cover several states. A follow-up could mark versions whose contents changed within them.
- **"What changed in release R" can't rest on VCV versions.** 8,977 of these 9,086 removals moved no version.

## Open questions

1. **Is this intended?** It contradicts ClinVar's documentation. Worth raising with NCBI, and with the ClinVar-GKM team, who may already know.
2. **Why did VCV 559557 get a new version?** Compare its 2026-10-11 and 2026-10-18 `VariationArchive`.
3. **Why are SCVs removed in batches?** A submitter withdrawing records, or ClinVar removing them? ClinVar's XML for the removed SCVs (or NCBI's removed-records reports) may say.
4. **What else changes without a version?** [history.md](../history.md#how-clinvar-versions-records) already found 5,839 SCVs a week changed without a new SCV version (MedGen re-mappings among them).

## How it was measured

**The release history's log** (`data/history/log/`, upstream's records as published; [history.md](../history.md#the-log)), with DuckDB. `$L` is the log's directory.

```sql
-- Every SCV key, with the release it was added in and the one that closed it, if any.
CREATE TEMP TABLE scvk AS SELECT a.key, regexp_extract(a.key, 'SCV[0-9]+') AS acc, a.release AS f, c.release AS t
  FROM read_parquet('$L/added/scv/*/*.parquet', hive_partitioning = true) a
  LEFT JOIN read_parquet('$L/closed/scv/*/*.parquet', hive_partitioning = true) c ON c.key = a.key AND c.valid_from = a.release;
-- Removed: closed, with no key of the same accession added in that release (a new version would be).
CREATE TEMP TABLE removed AS SELECT d.key, d.acc, d.t AS release FROM scvk d
  WHERE d.t IS NOT NULL AND NOT EXISTS (SELECT 1 FROM scvk n WHERE n.acc = d.acc AND n.f = d.t);
-- VCV evidence lines, with the VCV and its version from the key (VCV000001828.5-G-PATH-CP.contributing).
CREATE TEMP TABLE el AS SELECT a.key, regexp_extract(a.key, '^(VCV[0-9]+)\.', 1) AS vcv,
    regexp_extract(a.key, '^VCV[0-9]+\.([0-9]+)-', 1)::INT AS ver, a.release AS f, c.release AS t,
    CAST(a.rec::JSON->'hasEvidenceItems' AS VARCHAR[]) AS items
  FROM read_parquet('$L/added/evidenceLine/*/*.parquet', hive_partitioning = true) a
  LEFT JOIN read_parquet('$L/closed/evidenceLine/*/*.parquet', hive_partitioning = true) c ON c.key = a.key AND c.valid_from = a.release
  WHERE a.key LIKE 'VCV%';
-- The VCV versions citing each removed SCV just before its removal.
CREATE TEMP TABLE cited AS SELECT DISTINCT d.acc, d.release, e.vcv, e.ver FROM removed d JOIN el e
  ON e.f < d.release AND e.t = d.release AND list_contains(e.items, '#/scv/' || d.key);
-- What became of each VCV in the removal's release.
SELECT CASE WHEN EXISTS (SELECT 1 FROM el n WHERE n.vcv = c.vcv AND n.f = c.release AND n.ver > c.ver) THEN 'new version'
            WHEN EXISTS (SELECT 1 FROM el n WHERE n.vcv = c.vcv AND n.f = c.release AND n.ver = c.ver) THEN 'same version, rewritten'
            ELSE 'same version, line gone' END AS outcome,
       count(*) AS removals, count(DISTINCT c.vcv) AS vcvs
FROM cited c GROUP BY 1;
```

For the removals with a new version, compare the SCV keys the old and new versions' evidence lines cite: 108 of 109 cite one the old version didn't.

**ClinVar's VCV XML,** `ClinVarVCVRelease_2026-0923.xml.gz` and `ClinVarVCVRelease_2026-0928.xml.gz` (about 6 GB each), from clinvar-ingest's dev executions bucket (`executions/clinvar_vcv_<release>/clinvar_xml/`). Both checked by size and MD5 against the bucket, and with `gzip -t`. [vcv-versions-extract.py](vcv-versions-extract.py) streams a release and keeps the `VariationArchive` of each VariationID asked for (about 4 minutes a release with pigz); [vcv-versions-compare.py](vcv-versions-compare.py) diffs two releases' cuts:

```sh
python3 -I docs/research/vcv-versions-extract.py ClinVarVCVRelease_2026-0928.xml.gz <out dir> 2026-09-28 1828 5 762 853 576 612 119
python3 -I docs/research/vcv-versions-compare.py <out dir> 2026-09-23 2026-09-28 1828 5 762 853 576 612 119
```

The release files and the cut records were kept on the development Mac (`data/clinvar-vcv-xml/`), not committed.
