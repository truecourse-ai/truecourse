import { z } from 'zod'

/** Recipe-owned private starting state. Runtime allocations never enter authored YAML. */
export const GuardPreparationNameSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/)
export const GuardPreparationBaselineSchema = z.enum(['empty', 'seeded'])
export type GuardPreparationBaseline = z.infer<typeof GuardPreparationBaselineSchema>
export const GuardPreparationEvidenceSchema = z.object({
  profile: GuardPreparationNameSchema, baseline: GuardPreparationBaselineSchema, scope: z.literal('instance'),
}).strict()
export type GuardPreparationEvidence = z.infer<typeof GuardPreparationEvidenceSchema>
