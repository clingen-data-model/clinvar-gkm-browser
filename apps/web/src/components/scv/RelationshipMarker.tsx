import type { ScvRow } from '@cvb/shared/api';
import { count } from '../../lib/text.ts';

/**
 * On a gene's list: how the row's variant relates to the gene, when it isn't simply within it.
 * Names the other genes it's in for an overlap, and how many a spanning variant covers.
 */
export function RelationshipMarker({ relationship }: { relationship: ScvRow['geneRelationship'] }) {
  if (relationship === null || relationship.relationship === 'single') return null;
  const others = relationship.otherGenes;
  const more = relationship.otherGeneCount - others.length;
  const text = {
    overlap: `also in ${others.join(', ')}${more > 0 ? ` and ${count(more, 'more gene')}` : ''}`,
    spanning: `spans ${count(relationship.otherGeneCount + 1, 'gene')}`,
    near: 'near the gene',
    asserted: 'gene named by the submitter',
  }[relationship.relationship];
  const title =
    others.length === 0
      ? undefined
      : `Other genes: ${others.join(', ')}${more > 0 ? `, and ${count(more, 'more')}` : ''}`;
  return (
    <span title={title} className="block text-xs whitespace-nowrap text-muted-foreground">
      {text}
    </span>
  );
}
