import { z } from 'zod'
import { GuardWebLocatorSchema } from './web-steps.js'
import { GuardStreamMatcherSchema } from './step-parts.js'

const identity = {
  version: z.literal(1),
  /** Stable producer assertion position within the failing step. */
  assertion: z.string().min(1),
  /** Full page URL; only a proven runner origin may use a server marker. */
  page: z.string().min(1),
}

export const GuardFailureObservationSchema = z.discriminatedUnion('kind', [
  z.object({
    ...identity,
    kind: z.literal('web-target'),
    operation: z.string().min(1),
    locator: GuardWebLocatorSchema,
    matchCount: z.number().int().nonnegative(),
    visibility: z.enum(['visible', 'hidden', 'not-checked', 'unknown']),
    reason: z.enum(['absent', 'ambiguous', 'hidden']),
  }).strict(),
  z.object({
    ...identity,
    kind: z.literal('web-text'),
    scope: GuardWebLocatorSchema.optional(),
    matcher: GuardStreamMatcherSchema,
    operator: z.enum(['equals', 'contains', 'matches', 'compare']),
    observed: z.literal(false),
    /** SHA-256 of complete captured text, before display truncation. */
    textDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  }).strict(),
]).superRefine((observation, ctx) => {
  if (observation.kind !== 'web-target') return
  const consistent = observation.reason === 'absent'
    ? observation.matchCount === 0
    : observation.reason === 'hidden'
      ? observation.matchCount === 1 && observation.visibility === 'hidden'
      : observation.matchCount > 1
  if (!consistent) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'target reason must agree with observed count and visibility' })
})
export type GuardFailureObservation = z.infer<typeof GuardFailureObservationSchema>
