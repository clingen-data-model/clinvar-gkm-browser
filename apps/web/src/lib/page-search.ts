import { z } from 'zod';

/** ?page=N on paged pages. Optional, so links needn't give it; anything invalid is page 1. */
export const PageSearch = z.object({
  page: z.coerce.number().int().min(1).optional().catch(undefined),
});
