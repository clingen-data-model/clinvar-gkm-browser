/**
 * Attribution and disclaimer, as ClinVar and ClinVar-GKM ask. The wording is copied from ClinVar-GKM's
 * release manifest (https://data.clinvar-gkm.org/v1/1.1/parquet/manifest.json, as of the
 * 2026-10-18 release):
 * - the ClinVar citation and DOI: `source.citation`;
 * - citing ClinVar-GKM's DOI when using its files: `attribution`;
 * - the disclaimer: `disclaimer`, ClinVar's own, which the manifest says applies. It says this of
 *   ClinVar-GKM; "and this browser" is ours;
 * - the data use links: `source.data_use_policy` (ClinVar's) and `data_use` (ClinVar-GKM's).
 * Hard-coded for now: check the manifest when its schema version changes.
 */
export function SiteFooter() {
  return (
    <footer className="bg-footer text-sm">
      <div className="mx-auto w-full max-w-7xl space-y-3 px-4 pt-8 pb-6">
        <p>
          Data from NCBI&rsquo;s <a href="https://www.ncbi.nlm.nih.gov/clinvar/">ClinVar</a>{' '}
          (Landrum MJ, et al. ClinVar: updates to support classifications of both germline and
          somatic variants. Nucleic Acids Res. 2025;53(D1):D1313-D1321.{' '}
          <a href="https://doi.org/10.1093/nar/gkae1090">doi:10.1093/nar/gkae1090</a>), as published
          in GA4GH formats by{' '}
          <a href="https://dataexchange.clinicalgenome.org/clinvar-gkm/">ClinVar-GKM</a> (
          <a href="https://doi.org/10.5281/zenodo.18343663">doi:10.5281/zenodo.18343663</a>).
        </p>
        <p>
          The information is not intended for direct diagnostic use or medical decision-making
          without review by a genetics professional. ClinVar-GKM and this browser are not NCBI, NLM
          or NIH products and are not endorsed by them. Data use:{' '}
          <a href="https://www.ncbi.nlm.nih.gov/clinvar/docs/maintenance_use/#disclaimer">
            ClinVar&rsquo;s policy and disclaimer
          </a>
          , <a href="https://dataexchange.clinicalgenome.org/clinvar-gkm/data-use/">ClinVar-GKM</a>.
        </p>
      </div>
    </footer>
  );
}
