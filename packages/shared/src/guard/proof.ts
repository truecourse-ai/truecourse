import { z } from 'zod'
import { GuardDriverIdSchema } from './drivers.js'
import type { GuardFlowMilestone } from './flows.js'
import { isApiStep } from './api-steps.js'
import { isWebStep } from './web-steps.js'
import { milestoneRefs, type GuardStepMilestone } from './step-parts.js'

/** An assertion's milestone and the driver that observes it, not setup drivers. */
export const GuardMilestoneProofSchema = z.object({
  milestone: z.number().int().positive(),
  driver: GuardDriverIdSchema,
}).strict()
export type GuardMilestoneProof = z.infer<typeof GuardMilestoneProofSchema>

export type GuardProofStep = {
  milestone?: GuardStepMilestone; expect?: unknown
  boot?: { expect?: unknown }; signal?: { expect?: unknown }; logs?: unknown
}

/** Lifecycle verbs carry their assertions inside the verb, unlike HTTP/UI steps. */
function hasAssertion(step: GuardProofStep): boolean {
  const nonempty = (v: unknown) => !!v && typeof v === 'object' && Object.keys(v).length > 0
  return nonempty(step.expect) || (step.boot !== undefined && (step.boot.expect === undefined || nonempty(step.boot.expect))) ||
    nonempty(step.signal?.expect) || nonempty(step.logs)
}

/** Which milestones the steps prove, and on which driver each assertion sits. */
export function scenarioMilestoneProof(
  steps: readonly GuardProofStep[],
): GuardMilestoneProof[] {
  const proof: GuardMilestoneProof[] = []
  for (const step of steps) {
    const orders = milestoneRefs(step.milestone).filter((r): r is number => typeof r === 'number')
    if (!orders.length || !hasAssertion(step)) continue
    const driver = isWebStep(step) ? 'web' : isApiStep(step) ? 'api' : 'cli'
    for (const milestone of orders) {
      if (!proof.some(p => p.milestone === milestone && p.driver === driver)) proof.push({ milestone, driver })
    }
  }
  return proof
}

/**
 * Whether the proof covers every milestone; undefined for a flow with none. A
 * milestone is proved by any surface's assertion, since one test writer drives
 * every surface.
 */
export function coversFlowMilestones(
  milestones: readonly GuardFlowMilestone[],
  proof: readonly GuardMilestoneProof[],
): boolean | undefined {
  if (milestones.length === 0) return undefined
  return milestones.every(m => proof.some(p => p.milestone === m.order))
}

/** Selected milestones are exactly the tagged ones; setup can be untagged.
 * Every selected milestone needs an executable assertion. */
export function scenarioMilestoneScopeDefect(
  milestones: readonly GuardFlowMilestone[],
  steps: readonly GuardProofStep[],
): string | undefined {
  const selected = [...new Set(steps.flatMap((s) => milestoneRefs(s.milestone)).filter((n): n is number => typeof n === 'number'))]
  if (!selected.length) return 'Select at least one milestone to verify; untagged setup alone is not coverage.'
  const proof = scenarioMilestoneProof(steps)
  for (const order of selected) {
    if (!milestones.some((m) => m.order === order)) return `step milestone ${order} matches no milestone of this flow`
    if (!proof.some((p) => p.milestone === order)) return `milestone ${order} needs an assertion`
  }
  return undefined
}

/** A published candidate must independently prove the immutable entire flow. */
export function scenarioFullFlowDefect(
  milestones: readonly GuardFlowMilestone[],
  steps: readonly GuardProofStep[],
): string | undefined {
  const scope = scenarioMilestoneScopeDefect(milestones, steps)
  if (scope) return scope
  const proof = scenarioMilestoneProof(steps)
  for (const milestone of milestones) {
    if (!proof.some(p => p.milestone === milestone.order)) return `One complete test must assert every milestone; milestone ${milestone.order} is missing.`
  }
  return undefined
}
