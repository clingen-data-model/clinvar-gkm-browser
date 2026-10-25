import { z } from 'zod';

/** RFC 9457 problem details, the body of every error response (`application/problem+json`). */
export const ProblemDetails = z.object({
  type: z.string(),
  title: z.string(),
  status: z.int(),
  detail: z.string(),
  /** Present on validation errors: one entry per invalid parameter. */
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetails>;
