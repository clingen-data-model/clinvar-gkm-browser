import { useNavigate, useSearch } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useId, useState } from 'react';

/**
 * One box for everything: identifiers, HGVS and names go to /search, which recognizes them. It
 * shows the current search's text, following the URL as it changes (the header's box stays
 * mounted across pages).
 */
export function SearchBox({ autoFocus = false }: { autoFocus?: boolean }) {
  const current = useSearch({ strict: false, select: (s) => (typeof s.q === 'string' ? s.q : '') });
  return <SearchForm key={current} current={current} autoFocus={autoFocus} />;
}

function SearchForm({ current, autoFocus }: { current: string; autoFocus: boolean }) {
  const navigate = useNavigate();
  const id = useId();
  const [value, setValue] = useState(current);
  return (
    <form
      role="search"
      aria-label="ClinVar"
      onSubmit={(event) => {
        event.preventDefault();
        const q = value.trim();
        if (q !== '') void navigate({ to: '/search', search: { q } });
      }}
      className="relative"
    >
      <label htmlFor={id} className="sr-only">
        Search ClinVar
      </label>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
        }}
        autoFocus={autoFocus}
        placeholder="Gene, condition, submitter, VCV/SCV/RCV, rsID, HGVS, chr-pos-ref-alt…"
        className="w-full rounded-md border border-border bg-background py-2 pr-3 pl-9 text-sm"
      />
    </form>
  );
}
