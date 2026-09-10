import { z } from 'zod'
import { GuardDriverIdSchema, guardDriverIds, type GuardDriverId } from './drivers.js'
import type { GuardFlowMilestone } from './flows.js'
import { isApiStep } from './api-steps.js'
import { isWebStep } from './web-steps.js'
import { milestoneRefs, milestoneOrder, type GuardStepMilestone } from './step-parts.js'

/** An assertion's milestone and the driver that observes it, not setup drivers. */
export const GuardMilestoneProofSchema = z.object({
  milestone: z.number().int().positive(),
  driver: GuardDriverIdSchema,
  checks: z.array(z.string().min(1)).optional(),
}).strict()
export type GuardMilestoneProof = z.infer<typeof GuardMilestoneProofSchema>

export type GuardProofStep = {
  milestone?: GuardStepMilestone; expect?: unknown; checks?: string[]
  boot?: { expect?: unknown }; signal?: { expect?: unknown }; logs?: unknown
}

/** Lifecycle verbs carry their assertions inside the verb, unlike HTTP/UI steps. */
function hasAssertion(step: GuardProofStep): boolean {
  const nonempty = (v: unknown) => !!v && typeof v === 'object' && Object.keys(v).length > 0
  return nonempty(step.expect) || (step.boot !== undefined && (step.boot.expect === undefined || nonempty(step.boot.expect))) ||
    nonempty(step.signal?.expect) || nonempty(step.logs)
}

export function scenarioMilestoneProof(
  steps: readonly GuardProofStep[],
): GuardMilestoneProof[] {
  const proof: GuardMilestoneProof[] = []
  for (const step of steps) {
    const orders = milestoneRefs(step.milestone).filter((r): r is number => typeof r === 'number')
    if (!orders.length || !hasAssertion(step)) continue
    const driver = isWebStep(step) ? 'web' : isApiStep(step) ? 'api' : 'cli'
    for (const milestone of orders) {
      const existing = proof.find(p => p.milestone === milestone && p.driver === driver)
      if (existing) {
        if (step.checks) existing.checks = [...new Set([...(existing.checks ?? []), ...step.checks])]
      } else proof.push({ milestone, driver, ...(step.checks ? { checks: [...new Set(step.checks)] } : {}) })
    }
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
  return milestones.every(m => {
    const accepted = proof.filter(p => p.milestone === m.order && m.proofDrivers!.includes(p.driver))
    return m.verification?.cases?.length
      ? m.verification.cases.every(c => accepted.some(p => p.checks?.includes(c.id)))
      : accepted.length > 0
  })
}

/** Selected milestones are exactly the tagged ones; setup can be untagged.
 * Every selected obligation needs an assertion on an accepted proof driver. */
export function scenarioMilestoneScopeDefect(
  milestones: readonly GuardFlowMilestone[],
  steps: readonly GuardProofStep[],
): string | undefined {
  const selected = [...new Set(steps.flatMap((s) => milestoneRefs(s.milestone)).filter((n): n is number => typeof n === 'number'))]
  if (!selected.length) return 'Select at least one milestone to verify; untagged setup alone is not coverage.'
  const proof = scenarioMilestoneProof(steps)
  for (const step of steps) {
    if (step.checks?.length && (!hasAssertion(step) || !milestoneOrder(step.milestone))) return 'Case checks need a milestone and an executable assertion.'
  }
  for (const order of selected) {
    const m = milestones.find((m) => m.order === order)
    if (!m) return `step milestone ${order} matches no milestone of this flow`
    const accepted = proof.filter((p) => p.milestone === order && (!m.proofDrivers || m.proofDrivers.includes(p.driver)))
    if (m.verification?.cases) {
      const ids = new Set(m.verification.cases.map(c => c.id))
      if (!accepted.some(p => p.checks?.length)) return `milestone ${order} must name the case ids its assertions verify in checks`
      for (const p of accepted) if (p.checks?.some(id => !ids.has(id))) return `milestone ${order} names an unknown verification case`
    }
    if (!accepted.length) return `milestone ${order} needs an assertion using its proof drivers: ${m.proofDrivers?.join(' or ') ?? 'the scenario driver'}`
  }
  return undefined
}

/** A published candidate must independently prove the immutable entire flow. */
export function scenarioFullFlowDefect(
  milestones: readonly GuardFlowMilestone[],
  steps: readonly GuardProofStep[],
  evidence?: readonly GuardCaseEvidence[],
): string | undefined {
  const scope = scenarioMilestoneScopeDefect(milestones, steps)
  if (scope) return scope
  const proof = scenarioMilestoneProof(steps)
  for (const milestone of milestones) {
    const accepted = proof.filter(p => p.milestone === milestone.order && (!milestone.proofDrivers || milestone.proofDrivers.includes(p.driver)))
    if (!accepted.length) return `One complete test must assert every milestone; milestone ${milestone.order} is missing.`
    const missing = milestone.verification?.cases?.filter(c => !accepted.some(p => p.checks?.includes(c.id))) ?? []
    if (missing.length) return `One complete test must assert every selected case; milestone ${milestone.order} is missing: ${missing.map(c => c.id).join(', ')}.`
  }
  return evidence === undefined ? undefined : caseEvidenceDefect(milestones, steps, evidence)
}

/** Evidence supplied by the independent fidelity reviewer for selected cases. */
export const GuardCaseEvidenceSchema = z.object({
  milestone: z.number().int().positive(),
  caseId: z.string().min(1),
  steps: z.array(z.number().int().positive()).min(1),
  reason: z.string().min(1),
}).strict()
export type GuardCaseEvidence = z.infer<typeof GuardCaseEvidenceSchema>

/** Engine-derived immutable inputs to independent proof-reference validation. */
export interface GuardEvidenceProofContext {
  readonly milestones: readonly GuardFlowMilestone[]
  readonly steps: readonly GuardProofStep[]
}

export interface GuardCaseEvidenceIssue {
  kind: 'scope' | 'missing-evidence' | 'duplicate-evidence' | 'unselected-case' |
    'invalid-step-reference' | 'wrong-driver' | 'wrong-milestone' | 'untagged-step' | 'non-asserting-step'
  milestone?: number
  caseId?: string
  stepIndex?: number
  actual?: { driver: GuardDriverId; milestones: number[]; checks: string[]; asserting: boolean }
  eligibleStepIndices: number[]
  message: string
}

/** Validate references without changing assertions, case annotations, or semantic review. */
export function caseEvidenceIssues(
  milestones: readonly GuardFlowMilestone[],
  steps: readonly GuardProofStep[],
  evidence: readonly GuardCaseEvidence[] = [],
): GuardCaseEvidenceIssue[] {
  const issues: GuardCaseEvidenceIssue[] = []
  if (milestones.some(m => m.verification?.cases)) {
    const defect = scenarioMilestoneScopeDefect(milestones, steps)
    if (defect) issues.push({ kind: 'scope', message: defect, eligibleStepIndices: [] })
  }
  const selected = scenarioMilestoneProof(steps)
  const selectedCases = new Map<string, { milestone: number; caseId: string; drivers: GuardDriverId[] }>()
  for (const proof of selected) {
    const milestone = milestones.find(m => m.order === proof.milestone)
    if (!milestone?.verification?.cases) continue
    for (const caseId of proof.checks ?? []) {
      if (!milestone.verification.cases.some(c => c.id === caseId)) continue
      selectedCases.set(`${proof.milestone}/${caseId}`, {
        milestone: proof.milestone, caseId, drivers: milestone.proofDrivers ?? [proof.driver],
      })
    }
  }
  for (const selectedCase of selectedCases.values()) {
    const { milestone, caseId, drivers } = selectedCase
    const eligibleStepIndices = steps.flatMap((step, i) => scenarioMilestoneProof([step]).some(p =>
      p.milestone === milestone && drivers.includes(p.driver) && p.checks?.includes(caseId)) ? [i + 1] : [])
    const entries = evidence.filter(e => e.milestone === milestone && e.caseId === caseId)
    const base = { milestone, caseId, eligibleStepIndices }
    if (entries.length !== 1) issues.push({ ...base,
      kind: entries.length ? 'duplicate-evidence' : 'missing-evidence',
      message: `Case ${milestone}/${caseId} needs one independent review identifying its assertion steps; received ${entries.length}.`,
    })
    for (const entry of entries) {
      if (!entry.steps.length) issues.push({ ...base, kind: 'missing-evidence',
        message: `Case ${milestone}/${caseId} needs at least one proof-bearing assertion step.` })
      for (const stepIndex of entry.steps) {
        if (!Number.isInteger(stepIndex) || stepIndex < 1 || stepIndex > steps.length) {
          issues.push({ ...base, kind: 'invalid-step-reference', stepIndex,
            message: `Case ${milestone}/${caseId} cites step ${stepIndex}, which does not assert the case: expected a one-based integer from 1 to ${steps.length}.` })
          continue
        }
        const step = steps[stepIndex - 1]
        const actual = { driver: (isWebStep(step) ? 'web' : isApiStep(step) ? 'api' : 'cli') as GuardDriverId,
          milestones: milestoneRefs(step.milestone).filter((n): n is number => typeof n === 'number'),
          checks: step.checks ?? [], asserting: hasAssertion(step) }
        const kind = !actual.asserting ? 'non-asserting-step' : !drivers.includes(actual.driver) ? 'wrong-driver' :
          !actual.milestones.includes(milestone) ? 'wrong-milestone' : !actual.checks.includes(caseId) ? 'untagged-step' : undefined
        if (kind) issues.push({ ...base, kind, stepIndex, actual,
          message: `Case ${milestone}/${caseId} cites step ${stepIndex}, which does not assert that case on its proof driver (${kind}; driver ${actual.driver}, milestones [${actual.milestones.join(', ')}], checks [${actual.checks.join(', ')}]).` })
      }
    }
  }
  for (const entry of evidence) if (!selectedCases.has(`${entry.milestone}/${entry.caseId}`)) {
    issues.push({ kind: 'unselected-case', milestone: entry.milestone, caseId: entry.caseId,
      eligibleStepIndices: [], message: `Review names unselected case ${entry.milestone}/${entry.caseId}.` })
  }
  return issues
}

export function formatCaseEvidenceIssues(issues: readonly GuardCaseEvidenceIssue[]): string {
  return issues.map(issue => `${issue.message}${issue.milestone !== undefined && issue.caseId !== undefined
    ? ` Eligible tagged assertion steps: [${issue.eligibleStepIndices.join(', ')}].` : ''}`).join('\n')
}

/** Compatibility formatter. New review/session consumers should retain the structured issues. */
export function caseEvidenceDefect(
  milestones: readonly GuardFlowMilestone[],
  steps: readonly GuardProofStep[],
  evidence: readonly GuardCaseEvidence[] = [],
): string | undefined {
  const issues = caseEvidenceIssues(milestones, steps, evidence)
  return issues.length ? formatCaseEvidenceIssues(issues) : undefined
}

/** Scope the committed promise to the assertions actually submitted for review. */
export function scenarioCoverageClaims(milestones: readonly GuardFlowMilestone[], steps: Parameters<typeof scenarioMilestoneProof>[0]): string[] {
  const proof = scenarioMilestoneProof(steps)
  return milestones.flatMap(m => {
    const selected = proof.filter(p => p.milestone === m.order)
    if (!selected.length) return []
    return m.verification?.cases
      ? m.verification.cases.filter(c => selected.some(p => p.checks?.includes(c.id))).map(c => c.claim)
      : [m.claimTitle]
  })
}
