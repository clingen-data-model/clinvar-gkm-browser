import { createFileRoute, Link } from '@tanstack/react-router';
import { SearchBox } from '../components/shell/SearchBox.tsx';

export const Route = createFileRoute('/')({ component: Home });

const examples = [
  { q: 'BRCA1', what: 'a gene' },
  { q: 'Hereditary breast ovarian cancer syndrome', what: 'a condition' },
  { q: 'GeneDx', what: 'a submitter' },
  { q: 'VCV000017661', what: 'a variant' },
  { q: 'rs80357914', what: 'an rsID' },
  { q: 'NM_007294.4:c.181T>G', what: 'HGVS' },
  { q: '17-43106487-A-C', what: 'a GRCh38 position' },
];

function Home() {
  return (
    <>
      <title>ClinVar GKM browser</title>
      <div className="bg-band text-band-foreground">
        <div className="mx-auto w-full max-w-3xl px-4 py-12">
          <h1 className="text-band-title font-normal">Browse ClinVar by submission</h1>
          <p className="mt-2 text-band-muted-foreground">
            Every submitter&rsquo;s classification, filterable and comparable, with the conflicts
            between them. Built on ClinVar-GKM.
          </p>
          <div className="mt-6 text-foreground">
            <SearchBox autoFocus />
          </div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl px-4 py-8">
        <h2 className="mb-3 text-lg">Try</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {examples.map((e) => (
            <li key={e.q}>
              <Link to="/search" search={{ q: e.q }}>
                {e.q}
              </Link>{' '}
              <span className="text-muted-foreground">({e.what})</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
