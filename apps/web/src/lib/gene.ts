// A gene page's relationship selection (gene_relationship), shared by its tabs.

import { parseGeneRelationships } from '@cvb/shared/query';
import { z } from 'zod';

/** The gene page's own search state, which its tabs share. */
export const GeneSearch = z.object({
  gene_relationship: z.string().optional().catch(undefined),
});

/** The gene relationships selected (gene_relationship), or the default. */
export function relationshipsOf(param: string | undefined): readonly string[] {
  const parsed = parseGeneRelationships(param);
  return parsed.ok ? parsed.value : ['single', 'overlap'];
}

export function geneFilters(id: number, relationships: readonly string[]) {
  return { gene: id, gene_relationship: relationships.join(',') };
}
