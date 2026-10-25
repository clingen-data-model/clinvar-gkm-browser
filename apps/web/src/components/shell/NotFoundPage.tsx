import { Link } from '@tanstack/react-router';
import { Page } from './Page.tsx';

export function NotFoundPage() {
  return (
    <Page title="Not found">
      <p>There is nothing at this address in the current ClinVar release.</p>
      <p className="mt-4">
        <Link to="/">Search ClinVar</Link>
      </p>
    </Page>
  );
}
