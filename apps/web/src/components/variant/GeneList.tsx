import type { VariantGene } from '@cvb/shared/api';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { z } from 'zod';

const SHOWN = 8;

/** A variant's genes: all of them for most variants; the first few for a large CNV, expandable. */
export function GeneList({ genes }: { genes: z.infer<typeof VariantGene>[] }) {
  const [expanded, setExpanded] = useState(false);
  if (genes.length === 0) return <>—</>;
  const shown = expanded ? genes : genes.slice(0, SHOWN);
  return (
    <span className="break-words">
      {shown.map((g, i) => (
        <span key={g.geneId}>
          {i > 0 ? ', ' : ''}
          {g.symbol === null ? (
            `Gene ${String(g.geneId)}`
          ) : (
            <Link to="/genes/$id" params={{ id: g.geneId }}>
              {g.symbol}
            </Link>
          )}
        </span>
      ))}
      {genes.length > SHOWN ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded(!expanded);
          }}
          className="ml-2 rounded border border-band-muted-foreground px-1.5 text-xs text-band-foreground"
        >
          {expanded ? 'Show fewer' : `+${(genes.length - SHOWN).toLocaleString()} more`}
        </button>
      ) : null}
    </span>
  );
}
