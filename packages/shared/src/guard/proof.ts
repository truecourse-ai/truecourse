import { z } from 'zod'
import { GuardDriverIdSchema, guardDriverIds, type GuardDriverId } from './drivers.js'
import type { GuardFlowMilestone } from './flows.js'
import { isApiStep } from './api-steps.js'
import { isWebStep } from './web-steps.js'
import { milestoneOrder, type GuardStepMilestone } from './step-parts.js'

/** An assertion's milestone and the driver that observes it, not setup drivers. */
export const GuardMilestoneProofSchema = z.object({
  milestone: z.number().int().positive(),
  driver: GuardDriverIdSchema,
}).strict()
export type GuardMilestoneProof = z.infer<typeof GuardMilestoneProofSchema>

export function scenarioMilestoneProof(
  steps: readonly { milestone?: GuardStepMilestone; expect?: unknown }[],
): GuardMilestoneProof[] {
  const proof: GuardMilestoneProof[] = []
  for (const step of steps) {
    const milestone = milestoneOrder(step.milestone)
    if (!milestone || !step.expect || typeof step.expect !== 'object' || Object.keys(step.expect).length === 0) continue
    const driver = isWebStep(step) ? 'web' : isApiStep(step) ? 'api' : 'cli'
    if (!proof.some((p) => p.milestone === milestone && p.driver === driver)) proof.push({ milestone, driver })
  }
  return proof
}

/** Legacy flows have no driver requirements. Only estimates read those; generation
 * rebinds extracted claims before choosing drivers. Do not guess from prose. */
export function flowDriversToMatch(flow: { milestones: readonly GuardFlowMilestone[] }): GuardDriverId[] {
  if (flow.milestones.some((m) => !m.proofDrivers)) return [...guardDriverIds]
  return guardDriverIds.filter((driver) => flow.milestones.some((m) => m.proofDrivers!.includes(driver)))
}

/** Undefined means the older corpus has no requirements, never proof of completion. */
export function coversFlowMilestones(
  milestones: readonly GuardFlowMilestone[],
  proof: readonly GuardMilestoneProof[],
): boolean | undefined {
  if (milestones.length === 0 || milestones.some((m) => !m.proofDrivers)) return undefined
  return milestones.every((m) => proof.some((p) => p.milestone === m.order && m.proofDrivers!.includes(p.driver)))
}
