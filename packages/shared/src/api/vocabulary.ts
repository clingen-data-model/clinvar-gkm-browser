// /api/v1/vocabularies: every code list the app shows, and the query registry, in one response.
import { z } from 'zod';

export const Vocabularies = z.object({
  classificationTypes: z.array(
    z.object({
      code: z.string(),
      lane: z.enum(['G', 'S']),
      label: z.string(),
      conflictDetectable: z.boolean(),
    }),
  ),
  terms: z.array(
    z.object({
      classificationType: z.string(),
      term: z.string(),
      label: z.string(),
      significance: z.int(),
      bucket: z.enum(['P', 'V', 'B', 'O', 'N']),
    }),
  ),
  reviewStatuses: z.array(z.object({ status: z.string(), stars: z.int(), current: z.boolean() })),
  submissionLevels: z.array(z.object({ code: z.string(), label: z.string(), rank: z.int() })),
  filters: z.array(z.object({ name: z.string(), label: z.string(), description: z.string() })),
  /** Dimensions each resource's summaries group by. */
  dimensions: z.object({
    scvs: z.array(z.object({ name: z.string(), label: z.string() })),
    pairs: z.array(z.object({ name: z.string(), label: z.string() })),
    variants: z.array(z.object({ name: z.string(), label: z.string() })),
  }),
  conflictLevels: z.array(z.object({ level: z.int(), label: z.string(), example: z.string() })),
  conflictStatuses: z.array(z.object({ status: z.string(), label: z.string() })),
  conditionMatches: z.array(z.object({ code: z.string(), label: z.string() })),
  geneRelationships: z.array(z.object({ code: z.string(), label: z.string() })),
  /** Condition IDs of "not provided" and "not specified". */
  placeholderConditions: z.array(z.int()),
});
export type Vocabularies = z.infer<typeof Vocabularies>;
