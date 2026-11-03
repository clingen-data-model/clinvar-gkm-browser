import { Link } from '@tanstack/react-router';
import { useRelease } from '../../lib/release.ts';
import { Page } from './Page.tsx';

export function NotFoundPage() {
  // Rewound to a release from before a record existed, "current" would be wrong.
  const release = useRelease();
  return (
    <Page title="Not found">
      <p>
        There is nothing at this address in{' '}
        {release === undefined ? 'the current ClinVar release' : `ClinVar as of ${release}`}.
      </p>
      <p className="mt-4">
        <Link to="/">Search ClinVar</Link>
      </p>
    </Page>
  );
}
