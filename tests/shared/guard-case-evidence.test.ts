import { describe, expect, it } from 'vitest'
import { GuardScenarioSchema, caseEvidenceDefect, caseEvidenceIssues, coversFlowMilestones, scenarioMilestoneProof, scenarioMilestoneScopeDefect, verificationBoundaryProblems, verificationCapabilityGap, type GuardFlowMilestone, type GuardVerification } from '@truecourse/shared'
import { scenarioReviewFingerprint } from '@truecourse/shared/guard-proof-node'

import { emptyLedgerEvidenceContext, invalidEmptyLedgerEvidence, correctedEmptyLedgerEvidence } from '../fixtures/guard-completion/empty-ledger-evidence'

const verification: GuardVerification = {
  scope: 'api', method: 'behavior', observable: 'Read filtered results over HTTP',
  cases: ['literal-percent', 'ascii-case'].map(id => ({ id, claim: `Search handles ${id}`, method: 'behavior', requires: ['http'], conditions: [] })),
}
const milestones: GuardFlowMilestone[] = [{ order: 1, doc: 'spec.md', anchor: 'search', claimTitle: 'Search handles literal characters and ASCII case', proofDrivers: ['api'], verification }]
const step = { request: { method: 'GET', path: '/items?q=%25' }, expect: { status: 200, json: { totalCount: { equals: 1 } } }, milestone: 1, checks: ['literal-percent'] }

describe('independent case evidence', () => {
  it('does not award whole-milestone coverage to one tagged passing assertion', () => {
    expect(coversFlowMilestones(milestones, scenarioMilestoneProof([{ ...step, checks: undefined }]))).toBe(false)
    expect(coversFlowMilestones(milestones, scenarioMilestoneProof([step]))).toBe(false)
    expect(coversFlowMilestones(milestones, scenarioMilestoneProof([step, { ...step, checks: ['ascii-case'] }]))).toBe(true)
  })
  it('requires review evidence to cite an actual assertion for each selected case', () => {
    expect(caseEvidenceDefect(milestones, [step])).toContain('independent review')
    const evidence = [{ milestone: 1, caseId: 'literal-percent', steps: [1], reason: 'The literal input returns only the expected record.' }]
    expect(caseEvidenceDefect(milestones, [step], evidence)).toBeUndefined()
    expect(caseEvidenceDefect(milestones, [step], [{ ...evidence[0], steps: [2] }])).toContain('does not assert')
    expect(caseEvidenceDefect(milestones, [step], [{ ...evidence[0], caseId: 'ascii-case' }])).toBeDefined()
    expect(caseEvidenceDefect(milestones, [step], [...evidence, ...evidence])).toBeDefined()
  })
  it('reports the exact incident citations and eligible assertions without modifying either', () => {
    const { milestones, steps } = emptyLedgerEvidenceContext
    const original = JSON.stringify({ steps, evidence: invalidEmptyLedgerEvidence })
    expect(caseEvidenceIssues(milestones, steps, invalidEmptyLedgerEvidence)).toEqual([10, 11].map(stepIndex => ({
      kind: 'wrong-milestone', milestone: 3, caseId: 'empty-ledger-state', stepIndex,
      actual: { driver: 'web', milestones: [], checks: [], asserting: true }, eligibleStepIndices: [6, 7], message: expect.stringContaining(`step ${stepIndex}`),
    })))
    expect(caseEvidenceDefect(milestones, steps, correctedEmptyLedgerEvidence)).toBeUndefined()
    expect(JSON.stringify({ steps, evidence: invalidEmptyLedgerEvidence })).toBe(original)
  })
  it('distinguishes reference, driver, tag, scope, and missing proof defects', () => {
    const evidence = { milestone: 1, caseId: 'literal-percent', steps: [1], reason: 'Literal result assertion.' }
    expect(caseEvidenceIssues(milestones, [step], [])).toMatchObject([{ kind: 'missing-evidence', eligibleStepIndices: [1] }])
    expect(caseEvidenceIssues(milestones, [step], [evidence, evidence])).toMatchObject([{ kind: 'duplicate-evidence' }])
    expect(caseEvidenceIssues(milestones, [step], [{ ...evidence, steps: [0, 2, 1.5] }]).map(i => i.kind)).toEqual(Array(3).fill('invalid-step-reference'))
    expect(caseEvidenceIssues(milestones, [step], [{ ...evidence, caseId: 'ascii-case' }]).map(i => i.kind)).toContain('unselected-case')
    expect(caseEvidenceIssues(milestones, [step, { ...step, checks: undefined }], [{ ...evidence, steps: [2] }])).toMatchObject([{ kind: 'untagged-step', stepIndex: 2 }])
    expect(caseEvidenceIssues(milestones, [step, { ...step, expect: undefined, checks: undefined }], [{ ...evidence, steps: [2] }])).toMatchObject([{ kind: 'non-asserting-step' }])
    const wrongDriver = { run: ['echo', 'result'], expect: { stdout: { contains: 'result' } }, milestone: 1, checks: ['literal-percent'] }
    expect(caseEvidenceIssues(milestones, [step, wrongDriver], [{ ...evidence, steps: [2] }])).toMatchObject([{ kind: 'wrong-driver', actual: { driver: 'cli' }, eligibleStepIndices: [1] }])
    expect(caseEvidenceIssues(milestones, [{ ...step, expect: undefined }], [evidence]).map(i => i.kind)).toContain('scope')
  })
  it('rejects unknown case ids and requires checks on modern obligations', () => {
    expect(scenarioMilestoneScopeDefect(milestones, [{ ...step, checks: ['invented'] }])).toContain('unknown')
    expect(scenarioMilestoneScopeDefect(milestones, [{ ...step, checks: undefined }])).toContain('case ids')
    expect(scenarioMilestoneScopeDefect(milestones, [step])).toBeUndefined()
  })
  it('accounts for API boot, shutdown and log assertions on their actual step shapes', () => {
    const steps = [
      { boot: { expect: { ready: true } }, milestone: 1, checks: ['ready'] },
      { logs: { stream: 'stdout', match: 'Listening' }, milestone: 2, checks: ['startup-log'] },
      { signal: { name: 'SIGTERM', expect: { exitCode: 0 } }, milestone: 3, checks: ['shutdown'] },
    ]
    const parsed = GuardScenarioSchema.parse({ id: 'lifecycle', title: 'Lifecycle', binds: [{ doc: 'spec.md', section: 'start', fingerprint: 'sha256:abc' }], steps })
    expect(scenarioMilestoneProof(parsed.steps)).toEqual([
      { milestone: 1, driver: 'api', checks: ['ready'] },
      { milestone: 2, driver: 'api', checks: ['startup-log'] },
      { milestone: 3, driver: 'api', checks: ['shutdown'] },
    ])
    expect(scenarioMilestoneProof([{ signal: { name: 'SIGTERM' }, milestone: 3 }])).toEqual([])
  })
  it('preserves case tags through the executable scenario schema', () => {
    const scenario = GuardScenarioSchema.parse({ id: 'search', title: 'Literal search', binds: [{ doc: 'spec.md', section: 'search', fingerprint: 'sha256:abc' }], steps: [step] })
    expect(scenario.steps[0]).toMatchObject({ checks: ['literal-percent'] })
  })
  it('binds a review to assertion content, while ignoring object key ordering', () => {
    expect(scenarioReviewFingerprint({ steps: [step], title: 'Search' })).toBe(scenarioReviewFingerprint({ title: 'Search', steps: [step] }))
    expect(scenarioReviewFingerprint({ steps: [step] })).not.toBe(scenarioReviewFingerprint({ steps: [{ ...step, expect: { status: 200 } }] }))
  })
  it('handles multiple milestone tags rather than silently discarding later ones', () => {
    expect(scenarioMilestoneProof([{ ...step, milestone: [1, 2] }]).map(p => p.milestone)).toEqual([1, 2])
    expect(scenarioMilestoneScopeDefect(milestones, [{ ...step, milestone: [1, 99] }])).toContain('99 matches no milestone')
  })
})

describe('requirement scope versus observation and preparation', () => {
  it('tests empty startup through the browser without a database observation', () => {
    const v: GuardVerification = { scope: 'web', method: 'behavior', observable: 'Empty list and zero total', cases: [{ id: 'empty-start', claim: 'Starts empty', method: 'behavior', requires: ['browser'], conditions: ['fresh-state'] }] }
    expect(verificationBoundaryProblems(v, true)).toEqual([])
    expect(verificationCapabilityGap(v, 'web')).toBeUndefined()
    expect(verificationCapabilityGap(v, 'api')).toContain('browser')
  })
  it('refuses to bundle UI and database observations or normal and failed requests', () => {
    const mixed: GuardVerification = { ...verification, scope: 'web', cases: [{ ...verification.cases![0], method: 'datastore', requires: ['datastore'] }] }
    expect(verificationBoundaryProblems(mixed)).toEqual(expect.arrayContaining([expect.stringContaining('Split behavior'), expect.stringContaining('web obligation')]))
    const branches: GuardVerification = { ...verification, cases: [verification.cases![0], { ...verification.cases![1], conditions: ['request-failure'] }] }
    expect(verificationBoundaryProblems(branches)).toEqual(expect.arrayContaining([expect.stringContaining('Split independent'), expect.stringContaining('request-control')]))
  })
  it('retains internal guarantees and reports the actual missing capability', () => {
    expect(verificationCapabilityGap({ method: 'implementation', observable: 'Uses one transaction' }, 'api')).toContain('Unsupported observation: implementation')
    expect(verificationCapabilityGap({ scope: 'web', method: 'behavior', observable: 'Retry after a failed response', cases: [{ id: 'retry', claim: 'Retry works', method: 'behavior', requires: ['browser', 'request-control'], conditions: ['request-failure'] }] }, 'web')).toContain('request-control')
    expect(verificationBoundaryProblems(undefined, true)).toHaveLength(1)
  })
})
