import { z } from 'zod'

// ---------------------------------------------------------------------------
// Provenance — tracks where an invariant came from
// ---------------------------------------------------------------------------

export const InvariantProvenanceSchema = z.object({
  source: z.enum(['discovered', 'hand-authored']),
  inputs: z.array(z.enum(['code', 'spec'])).default(['code']),
  timestamp: z.string(),
  signal: z.string().optional(),
  specSection: z.string().optional(),
})
export type InvariantProvenance = z.infer<typeof InvariantProvenanceSchema>

// ---------------------------------------------------------------------------
// Invariant envelope — generic shape; plugin-specific declaration is validated
// by the plugin's own Zod schema, not here.
// ---------------------------------------------------------------------------

export const InvariantSchema = z.object({
  id: z.string(),
  type: z.string(),
  pluginVersion: z.number(),
  scope: z.string(),
  declaration: z.unknown(),
  provenance: InvariantProvenanceSchema,
  sourceFile: z.string().optional(),
})
export type Invariant = z.infer<typeof InvariantSchema>

// ---------------------------------------------------------------------------
// Draft — a candidate invariant awaiting human review
// ---------------------------------------------------------------------------

export const InvariantDraftSchema = z.object({
  id: z.string(),
  type: z.string(),
  pluginVersion: z.number(),
  scope: z.string(),
  declaration: z.unknown(),
  provenance: InvariantProvenanceSchema,
  rationale: z.string(),
  confidence: z.number().min(0).max(1),
})
export type InvariantDraft = z.infer<typeof InvariantDraftSchema>

// ---------------------------------------------------------------------------
// Rejected-draft signature — persisted so discovery doesn't resurface
// ---------------------------------------------------------------------------

export const RejectedDraftSchema = z.object({
  type: z.string(),
  scope: z.string(),
  signature: z.string(),
  rejectedAt: z.string(),
})
export type RejectedDraft = z.infer<typeof RejectedDraftSchema>

// ---------------------------------------------------------------------------
// Checkpoint — powers `suggest --diff` mode
// ---------------------------------------------------------------------------

export const InvariantCheckpointSchema = z.object({
  truecourseVersion: z.string(),
  timestamp: z.string(),
  fileHashes: z.record(z.string(), z.string()),
  specSectionHashes: z.record(z.string(), z.string()),
  coveredScopes: z.array(z.string()),
})
export type InvariantCheckpoint = z.infer<typeof InvariantCheckpointSchema>

// ---------------------------------------------------------------------------
// Drift status — derived at suggest time, surfaced in the review queue
// ---------------------------------------------------------------------------

export type InvariantDriftStatus = 'matches' | 'stale' | 'anchor-missing'

export const InvariantDriftSchema = z.object({
  invariantId: z.string(),
  status: z.enum(['matches', 'stale', 'anchor-missing']),
  summary: z.string().optional(),
})
export type InvariantDrift = z.infer<typeof InvariantDriftSchema>
