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
  dimensions: z.array(z.object({ name: z.string(), label: z.string() })),
});
export type Vocabularies = z.infer<typeof Vocabularies>;
