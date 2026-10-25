import type { GeneDetail } from '@cvb/shared/api';
import { GeneRelationship } from '@cvb/shared/query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

type Counts = GeneDetail['relationshipCounts'];

/**
 * Which of a gene's variants to include, by how ClinVar relates each to the gene: within it
 * alone, within it and an overlapping gene, spanning it, near it. The choice lives in the URL.
 * A click shows at once, before the page's data reloads; the parent keys this component on the
 * loaded selection, so the local state resets when the URL's choice changes.
 */
export function RelationshipSelector({
  counts,
  selected,
}: {
  counts: Counts;
  selected: readonly GeneRelationship[];
}) {
  const navigate = useNavigate();
  const [checked, setChecked] = useState<readonly GeneRelationship[]>(selected);
  const toggle = (relationship: GeneRelationship, on: boolean) => {
    const next = GeneRelationship.options.filter((r) =>
      r === relationship ? on : checked.includes(r),
    );
    if (next.length === 0) return;
    setChecked(next);
    void navigate({
      to: '.',
      search: (s) => ({ ...s, gene_relationship: next.join(','), page: undefined }),
      replace: true,
    });
  };
  return (
    <fieldset className="text-sm">
      <legend className="text-band-muted-foreground">Variants included</legend>
      <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
        {counts
          .filter((c) => c.variants > 0 || checked.includes(c.relationship))
          .map((c) => (
            <label key={c.relationship} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={checked.includes(c.relationship)}
                // At least one relationship stays selected.
                disabled={checked.length === 1 && checked.includes(c.relationship)}
                onChange={(event) => {
                  toggle(c.relationship, event.target.checked);
                }}
              />
              {c.label}{' '}
              <span className="text-band-muted-foreground">({c.variants.toLocaleString()})</span>
            </label>
          ))}
      </div>
    </fieldset>
  );
}
