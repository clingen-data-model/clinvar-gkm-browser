import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Stars } from '../components/classification/Stars.tsx';
import { TermPill } from '../components/classification/TermPill.tsx';
import { Page } from '../components/shell/Page.tsx';
import { Facts } from '../components/ui/Facts.tsx';
import { ScvVersionTable } from '../components/history/ScvVersionTable.tsx';
import { scvQuery, scvVersionsQuery, vocabulariesQuery } from '../lib/api/queries.ts';
import { idParams, orNotFound } from '../lib/route-params.ts';
import { useTypeLabels } from '../lib/vocabulary.ts';
import { useRelease } from '../lib/release.ts';

export const Route = createFileRoute('/scvs/$id')({
  params: idParams,
  loader: ({ context: { queryClient, release }, params }) =>
    orNotFound(
      Promise.all([
        queryClient.query(scvQuery(release, params.id)),
        queryClient.query(scvVersionsQuery(params.id)),
        queryClient.query(vocabulariesQuery(release)),
      ]),
    ),
  component: ScvPage,
});

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-border py-2 sm:grid-cols-[14rem_1fr]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function ScvPage() {
  const release = useRelease();
  const { id } = Route.useParams();
  const { release: shown, data: scv } = useSuspenseQuery(scvQuery(release, id)).data;
  const versions = useSuspenseQuery(scvVersionsQuery(id)).data.data;
  const typeLabels = useTypeLabels();
  return (
    <Page
      eyebrow="Submission"
      title={`${scv.accession}.${String(scv.version)}`}
      subtitle={scv.submitter.name}
      band={
        <Facts
          items={[
            [
              'Variant',
              <Link key="v" to="/variants/$id" params={{ id: scv.variationId }}>
                VCV{String(scv.variationId).padStart(9, '0')}
              </Link>,
            ],
            [
              'Classification type',
              typeLabels.get(scv.classificationType) ?? scv.classificationType,
            ],
            ['Last evaluated', scv.dateLastEvaluated ?? '—'],
          ]}
        />
      }
    >
      <dl className="max-w-4xl text-sm">
        <Row label="Classification">
          <TermPill label={scv.termLabel} bucket={scv.bucket} submitted={scv.classification} />
          {scv.submittedClassification === null ? null : (
            <span className="ml-2 text-muted-foreground">
              submitted as &ldquo;{scv.submittedClassification}&rdquo;
            </span>
          )}
        </Row>
        <Row label="Review status">
          <Stars stars={scv.stars} /> {scv.reviewStatus}
        </Row>
        <Row label="Submitter">
          <Link to="/submitters/$id" params={{ id: scv.submitter.submitterId }}>
            {scv.submitter.name}
          </Link>
        </Row>
        <Row label="Conditions">
          <ul>
            {scv.conditions.map((c) => (
              <li key={c.conditionId}>
                <Link to="/conditions/$id" params={{ id: c.conditionId }}>
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </Row>
        <Row label="As submitted">
          <ul>
            {scv.submittedConditions.map((c, i) => (
              <li key={`${c.name ?? ''}-${String(i)}`}>
                {c.name ?? '—'}
                {c.medgenId === null ? '' : ` (MedGen ${c.medgenId})`}
                {c.resolution === null ? null : (
                  <span className="text-muted-foreground"> · matched by {c.resolution}</span>
                )}
              </li>
            ))}
          </ul>
        </Row>
        <Row label="Collection method">{scv.collectionMethods?.join(', ') ?? '—'}</Row>
        <Row label="Assertion criteria">{scv.assertionCriteria ?? '—'}</Row>
        {scv.modeOfInheritance === null ? null : (
          <Row label="Mode of inheritance">{scv.modeOfInheritance}</Row>
        )}
        {scv.geneContext === null ? null : (
          <Row label="Gene">
            {scv.geneContext.symbol}
            {scv.submittedGeneSymbols !== null && scv.submittedGeneSymbols.length > 0 ? (
              <span className="text-muted-foreground">
                {' '}
                · submitted {scv.submittedGeneSymbols.join(', ')}
              </span>
            ) : null}
          </Row>
        )}
        <Row label="Dates">
          Created {scv.dateCreated ?? '—'} · last submitted {scv.dateSubmitted ?? '—'} · last
          evaluated {scv.dateLastEvaluated ?? '—'}
        </Row>
        <Row label="Aggregate statements">
          {scv.vcvStatementId}
          <br />
          {scv.rcvStatementId}
        </Row>
        {scv.comment === null ? null : (
          <Row label="Comment">
            <p className="max-w-prose whitespace-pre-line">{scv.comment}</p>
          </Row>
        )}
        {scv.citations.length === 0 ? null : (
          <Row label="Citations">
            <ul>
              {scv.citations.map((c, i) => (
                <li key={`${c.pmid ?? c.doi ?? ''}-${String(i)}`}>
                  {c.pmid === null ? (
                    (c.urls?.[0] ?? c.doi ?? c.name)
                  ) : (
                    <a href={`https://pubmed.ncbi.nlm.nih.gov/${c.pmid}/`}>PMID {c.pmid}</a>
                  )}
                </li>
              ))}
            </ul>
          </Row>
        )}
      </dl>

      <section aria-labelledby="versions" className="mt-10">
        <h2 id="versions" className="mb-3">
          Versions
        </h2>
        <ScvVersionTable versions={versions} shown={shown} />
      </section>
    </Page>
  );
}
