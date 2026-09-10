import type { GuardFlowMilestone } from './flows.js'
import type { GuardMilestoneProof } from './proof.js'

/** Bump when old reviews no longer establish the current assertion contract. */
export const GUARD_REVIEW_POLICY_VERSION = 3

export interface GuardObligation {
  milestone: number
  caseId?: string
  claim: string
}

/** Proof must already be checked against its scenario, bindings and review policy.
 * Keeping this calculation pure lets workers and persistence share the same rules.
 * Missing driver requirements are unknown, never proof of completion. */
export function guardCoverageProgress(
  milestones: readonly GuardFlowMilestone[],
  authoredProof: readonly GuardMilestoneProof[],
  passingProof: readonly GuardMilestoneProof[] = [],
) {
  const required = milestones.flatMap<GuardObligation>(m => m.verification?.cases?.length
    ? m.verification.cases.map(c => ({ milestone: m.order, caseId: c.id, claim: c.claim }))
    : [{ milestone: m.order, claim: m.claimTitle }])
  const covered = (o: GuardObligation, proof: readonly GuardMilestoneProof[]) => {
    const m = milestones.find(m => m.order === o.milestone)!
    return !!m.proofDrivers?.length && proof.some(p => p.milestone === o.milestone &&
      m.proofDrivers!.includes(p.driver) && (o.caseId === undefined || p.checks?.includes(o.caseId)))
  }
  const outstanding = required.filter(o => !covered(o, authoredProof))
  const passing = required.filter(o => covered(o, passingProof))
  const known = milestones.length > 0 && milestones.every(m => !!m.proofDrivers?.length)
  return { required, outstanding, authored: required.filter(o => covered(o, authoredProof)), passing,
    complete: known && outstanding.length === 0, known }
}

export function describeOutstandingObligations(obligations: readonly GuardObligation[]): string {
  return obligations.map(o => `- Milestone ${o.milestone}${o.caseId ? ` / ${o.caseId}` : ''}: ${o.claim}`).join('\n')
}
