/** Attribution and disclaimer, as ClinVar and ClinVar-GKM ask in their release manifests. */
export function SiteFooter() {
  return (
    <footer className="bg-footer text-sm">
      <div className="mx-auto w-full max-w-7xl space-y-3 px-4 pt-8 pb-6">
        <p>
          Data from NCBI&rsquo;s <a href="https://www.ncbi.nlm.nih.gov/clinvar/">ClinVar</a>{' '}
          (Landrum MJ, et al. ClinVar: updates to support classifications of both germline and
          somatic variants. Nucleic Acids Res. 2025;53(D1):D1313-D1321), as published in GA4GH
          formats by <a href="https://dataexchange.clinicalgenome.org/clinvar-gkm/">ClinVar-GKM</a>{' '}
          (doi:10.5281/zenodo.18343663).
        </p>
        <p>
          The information is not intended for direct diagnostic use or medical decision-making
          without review by a genetics professional. ClinVar-GKM and this browser are not NCBI, NLM
          or NIH products and are not endorsed by them.
        </p>
      </div>
    </footer>
  );
}
