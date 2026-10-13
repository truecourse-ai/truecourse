import type { GuardFlowMilestone } from './flows.js'
import type { GuardMilestoneProof } from './proof.js'

/** One milestone a flow's test must prove, with the claim it states. */
export interface GuardObligation {
  milestone: number
  claim: string
}

/** Proof must already be checked against its scenario and bindings. Keeping
 * this calculation pure lets workers and persistence share the same rules. */
export function guardCoverageProgress(
  milestones: readonly GuardFlowMilestone[],
  authoredProof: readonly GuardMilestoneProof[],
  passingProof: readonly GuardMilestoneProof[] = [],
) {
  const required = milestones.map<GuardObligation>(m => ({ milestone: m.order, claim: m.claimTitle }))
  // A milestone is proved by any surface's assertion.
  const covered = (o: GuardObligation, proof: readonly GuardMilestoneProof[]) => proof.some(p => p.milestone === o.milestone)
  const outstanding = required.filter(o => !covered(o, authoredProof))
  const passing = required.filter(o => covered(o, passingProof))
  const known = milestones.length > 0
  return { required, outstanding, authored: required.filter(o => covered(o, authoredProof)), passing,
    complete: known && outstanding.length === 0, known }
}

export function describeOutstandingObligations(obligations: readonly GuardObligation[]): string {
  return obligations.map(o => `- Milestone ${o.milestone}: ${o.claim}`).join('\n')
}
