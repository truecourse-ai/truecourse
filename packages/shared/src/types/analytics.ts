import { z } from 'zod'

// ---------------------------------------------------------------------------
// Trend (time series of violation counts per analysis)
// ---------------------------------------------------------------------------

export const TrendDataPointSchema = z.object({
  analysisId: z.string(),
  date: z.string(),
  branch: z.string().nullable(),
  total: z.number(),
  new: z.number(),
  unchanged: z.number(),
  resolved: z.number(),
  critical: z.number(),
  high: z.number(),
  medium: z.number(),
  low: z.number(),
  info: z.number(),
})
export type TrendDataPoint = z.infer<typeof TrendDataPointSchema>

export const TrendResponseSchema = z.object({
  points: z.array(TrendDataPointSchema),
})
export type TrendResponse = z.infer<typeof TrendResponseSchema>

// ---------------------------------------------------------------------------
// Breakdown (type & severity distribution for a single analysis)
// ---------------------------------------------------------------------------

export const BreakdownResponseSchema = z.object({
  byCategory: z.record(z.string(), z.number()),
  bySeverity: z.record(z.string(), z.number()),
  total: z.number(),
})
export type BreakdownResponse = z.infer<typeof BreakdownResponseSchema>

// ---------------------------------------------------------------------------
// Top Offenders (services/modules ranked by violation count)
// ---------------------------------------------------------------------------

export const TopOffenderSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['service', 'module']),
  violationCount: z.number(),
  criticalCount: z.number(),
  highCount: z.number(),
})
export type TopOffender = z.infer<typeof TopOffenderSchema>

export const TopOffendersResponseSchema = z.object({
  offenders: z.array(TopOffenderSchema),
  analysisId: z.string(),
})
export type TopOffendersResponse = z.infer<typeof TopOffendersResponseSchema>

// ---------------------------------------------------------------------------
// Resolution Velocity
// ---------------------------------------------------------------------------

export const ResolutionResponseSchema = z.object({
  avgTimeToResolveMs: z.number().nullable(),
  totalResolved: z.number(),
  totalActive: z.number(),
  resolutionRate: z.number(),
  staleCount: z.number(),
  staleDays: z.number(),
})
export type ResolutionResponse = z.infer<typeof ResolutionResponseSchema>
