import { useSuspenseQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { ScvTable } from '../components/scv/ScvTable.tsx';
import { Page } from '../components/shell/Page.tsx';
import { Facts } from '../components/ui/Facts.tsx';
import { AggregateCalls } from '../components/variant/AggregateCalls.tsx';
import { GeneList } from '../components/variant/GeneList.tsx';
import { variantQuery, variantScvsQuery, vocabulariesQuery } from '../lib/api/queries.ts';
import { idParams, orNotFound } from '../lib/route-params.ts';
import { useTypeLabels } from '../lib/vocabulary.ts';

export const Route = createFileRoute('/variants/$id')({
  params: idParams,
  loader: ({ context: { queryClient }, params }) =>
    orNotFound(
      Promise.all([
        queryClient.query(variantQuery(params.id)),
        queryClient.query(variantScvsQuery(params.id)),
        queryClient.query(vocabulariesQuery()),
      ]),
    ),
  component: VariantPage,
});

const SNP = 'https://www.ncbi.nlm.nih.gov/snp/';
const CAR = 'https://reg.clinicalgenome.org/';

function VariantPage() {
  const { id } = Route.useParams();
  const variant = useSuspenseQuery(variantQuery(id)).data.data;
  const scvs = useSuspenseQuery(variantScvsQuery(id)).data.data;
  const typeLabels = useTypeLabels();

  const rsids = variant.xrefs.filter((x) => x.system.startsWith(SNP)).map((x) => `rs${x.code}`);
  const caids = variant.xrefs.filter((x) => x.system.startsWith(CAR)).map((x) => x.code);
  const vrs = variant.vrs;
  const location =
    vrs?.sequenceAccession == null || vrs.start === null
      ? null
      : `${vrs.sequenceAccession}:${String(vrs.start + 1)}${vrs.end !== null && vrs.end !== vrs.start + 1 ? `-${String(vrs.end)}` : ''}`;
  const facts: [string, ReactNode][] = [
    ['Genes', <GeneList key="genes" genes={variant.genes} />],
    ['Type', variant.variationType],
    ['Location (GRCh38)', location ?? variant.cytogeneticLocation ?? '—'],
  ];
  if (rsids.length > 0)
    facts.push([
      'dbSNP',
      rsids.map((r) => (
        <a key={r} href={`${SNP}${r}`}>
          {r}{' '}
        </a>
      )),
    ]);
  if (caids.length > 0)
    facts.push([
      'ClinGen allele',
      caids.map((c) => (
        <a key={c} href={`${CAR}redmine/projects/registry/genboree_registry/by_caid?caid=${c}`}>
          {c}{' '}
        </a>
      )),
    ]);

  return (
    <Page
      eyebrow="Variant"
      title={variant.name}
      documentTitle={`${variant.vcvAccession} ${variant.name}`}
      subtitle={
        <>
          {variant.vcvAccession}
          {variant.vcvVersion === null ? '' : `.${String(variant.vcvVersion)}`} ·{' '}
          <a
            className="text-band-foreground"
            href={`https://www.ncbi.nlm.nih.gov/clinvar/variation/${String(id)}/`}
          >
            ClinVar
          </a>
          {vrs?.vcfKey == null ? null : (
            <>
              {' · '}
              <a
                className="text-band-foreground"
                href={`https://gnomad.broadinstitute.org/variant/${vrs.vcfKey}?dataset=gnomad_r4`}
              >
                gnomAD
              </a>
            </>
          )}
        </>
      }
      band={<Facts items={facts} />}
    >
      <section aria-labelledby="aggregate" className="mb-10">
        <h2 id="aggregate" className="mb-3">
          ClinVar&rsquo;s aggregate classification
        </h2>
        <AggregateCalls nodes={variant.aggregates} typeLabels={typeLabels} />
      </section>

      <section aria-labelledby="submissions" className="mb-10">
        <h2 id="submissions" className="mb-3">
          Submissions <span className="text-muted-foreground">({scvs.length})</span>
        </h2>
        <ScvTable rows={scvs} typeLabels={typeLabels} />
      </section>

      <section aria-labelledby="identifiers">
        <h2 id="identifiers" className="mb-3">
          Descriptions and identifiers
        </h2>
        {vrs === null ? (
          <p className="text-muted-foreground">
            No VRS representation{variant.vrsIssue === null ? '' : `: ${variant.vrsIssue}`}.
          </p>
        ) : (
          <p className="mb-3 text-sm">
            VRS {vrs.kind === 'allele' ? 'allele' : 'copy number'}{' '}
            <code className="break-all">{vrs.id}</code>
            {vrs.spdi === null ? null : (
              <>
                {' '}
                · SPDI <code>{vrs.spdi}</code>
              </>
            )}
          </p>
        )}
        <details>
          <summary className="cursor-pointer">HGVS expressions ({variant.hgvs.length})</summary>
          <table className="mt-2 text-sm">
            <tbody>
              {variant.hgvs.map((h, i) => (
                <tr
                  key={`${h.expression ?? ''}-${String(i)}`}
                  className="border-b border-border align-top"
                >
                  <td className="py-1 pr-4 font-mono break-all">{h.expression}</td>
                  <td className="py-1 pr-4 font-mono break-all">{h.proteinExpression}</td>
                  <td className="py-1 text-muted-foreground">
                    {[
                      h.maneSelect ? 'MANE Select' : null,
                      h.manePlus ? 'MANE Plus Clinical' : null,
                      ...(h.molecularConsequences ?? []),
                    ]
                      .filter((x) => x !== null)
                      .join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>
    </Page>
  );
}
