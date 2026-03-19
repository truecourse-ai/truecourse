import { z } from 'zod'

// ---------------------------------------------------------------------------
// Flow Step Types
// ---------------------------------------------------------------------------

export const FlowStepTypeSchema = z.enum(['call', 'http', 'db-read', 'db-write', 'event'])
export type FlowStepType = z.infer<typeof FlowStepTypeSchema>

export const FlowTriggerSchema = z.enum(['http', 'event', 'cron', 'startup'])
export type FlowTrigger = z.infer<typeof FlowTriggerSchema>

// ---------------------------------------------------------------------------
// Flow Step
// ---------------------------------------------------------------------------

export const FlowStepSchema = z.object({
  id: z.string(),
  flowId: z.string(),
  stepOrder: z.number(),
  sourceService: z.string(),
  sourceModule: z.string(),
  sourceMethod: z.string(),
  targetService: z.string(),
  targetModule: z.string(),
  targetMethod: z.string(),
  stepType: FlowStepTypeSchema,
  dataDescription: z.string().nullable(),
  isAsync: z.boolean(),
  isConditional: z.boolean(),
})

export type FlowStep = z.infer<typeof FlowStepSchema>

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

export const FlowSchema = z.object({
  id: z.string(),
  analysisId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  entryService: z.string(),
  entryMethod: z.string(),
  category: z.string(),
  trigger: FlowTriggerSchema,
  stepCount: z.number(),
  steps: z.array(FlowStepSchema).optional(),
  createdAt: z.string().optional(),
})

export type Flow = z.infer<typeof FlowSchema>
