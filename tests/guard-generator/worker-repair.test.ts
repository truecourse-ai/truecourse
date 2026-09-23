import { describe, expect, it } from 'vitest'
import type { GuardObligation, GuardRemainingObligation } from '@truecourse/shared'
import { obligationKey, outcomeCorrection, reconcileRemaining, type RepairIssue } from '../../packages/guard-generator/src/worker-repair'

const outstanding: GuardObligation[] = [
  { milestone: 1, caseId: 'cancel', claim: 'A valid draft is not saved when Cancel closes the dialog.' },
  { milestone: 1, caseId: 'total', claim: 'The controlled ledger total is exact.' },
]
const issue = (reasonKind: RepairIssue['reasonKind'], issueId: string, source?: RepairIssue['source']): RepairIssue =>
  ({ reasonKind, issueId, evidence: 'Current engine observation.', ...(source ? { source } : {}) })
const row = (caseId: string, reasonKind: GuardRemainingObligation['reasonKind'], issueId?: string): GuardRemainingObligation => ({
  milestone: 1, caseId, reasonKind, evidence: 'Worker explanation.', ...(issueId ? { issueId } : {}),
})

describe('current remaining obligation reconciliation', () => {
  it('requires exactly one disposition for each current obligation and excludes covered or foreign cases', () => {
    const issues = new Map([[obligationKey(outstanding[0]), issue('assertion', 'cancel-2')]])
    const invalid = reconcileRemaining(outstanding, issues, [row('cancel', 'assertion', 'cancel-2'), row('cancel', 'assertion', 'cancel-2'), row('already-covered', 'not-attempted')])
    expect(invalid.problems).toEqual([
      '1:cancel needs exactly one current remaining disposition.',
      '1:total needs exactly one current remaining disposition.',
      '1:already-covered is already covered or is not assigned to this worker.',
    ])
    expect(reconcileRemaining(outstanding, issues, [row('cancel', 'assertion', 'cancel-2'), row('total', 'not-attempted')]).problems).toEqual([])
  })

  it('rejects stale observations, wrong classifications and borrowed issue ids', () => {
    const issues = new Map([
      ['1:cancel', issue('assertion', 'cancel-2')], ['1:total', issue('preparation', 'total-1')],
    ])
    expect(reconcileRemaining(outstanding, issues, [row('cancel', 'assertion', 'cancel-1'), row('total', 'preparation', 'total-1')]).problems).toEqual([
      '1:cancel must reference current assertion issue cancel-2.',
    ])
    expect(reconcileRemaining(outstanding, issues, [row('cancel', 'unsupported-capability', 'cancel-2'), row('total', 'assertion', 'cancel-2')]).problems).toHaveLength(2)
    expect(reconcileRemaining(outstanding, new Map(), [row('cancel', 'preparation', 'invented'), row('total', 'not-attempted')]).problems).toEqual([
      '1:cancel has no engine observation establishing preparation.',
    ])
  })

  it('separates repairable assertions, annotations and untouched work from established external blockers', () => {
    const kinds: RepairIssue['reasonKind'][] = ['assertion', 'annotation', 'preparation', 'unsupported-capability', 'review-unavailable', 'not-attempted']
    const obligations = kinds.map((kind, index) => ({ milestone: index + 1, caseId: kind, claim: kind }))
    const issues = new Map(obligations.map((o, index) => [obligationKey(o), issue(kinds[index], `issue-${index}`)]))
    const result = reconcileRemaining(obligations, issues, undefined)
    expect(result.repairable.map(r => r.reasonKind)).toEqual(['assertion', 'annotation', 'not-attempted'])
    expect(result.current.map(r => r.reasonKind)).toEqual(kinds)
  })

  it('keeps the same case id in different milestones as separate obligations', () => {
    const obligations = [{ milestone: 1, caseId: 'same', claim: 'First' }, { milestone: 2, caseId: 'same', claim: 'Second' }]
    const result = reconcileRemaining(obligations, new Map([['1:same', issue('annotation', 'first')]]), [row('same', 'annotation', 'first')])
    expect(result.problems).toEqual(['2:same needs exactly one current remaining disposition.'])
    expect(result.current).toMatchObject([{ milestone: 1, issueId: 'first' }, { milestone: 2, reasonKind: 'not-attempted' }])
  })

  it('accepts an unsupported capability only as a blocked answer to a current fidelity flag', () => {
    const one = outstanding.slice(0, 1)
    const flagged = new Map([['1:cancel', issue('assertion', 'cancel-2', 'fidelity')]])
    const answer = [row('cancel', 'unsupported-capability', 'cancel-2')]
    const result = reconcileRemaining(one, flagged, answer, 'blocked')
    expect(result.problems).toEqual([])
    expect(result.current).toEqual([{ milestone: 1, caseId: 'cancel', reasonKind: 'unsupported-capability', evidence: 'Worker explanation.', issueId: 'cancel-2' }])
    // Still asked for one repair: the engine's own finding is an assertion.
    expect(result.repairable).toHaveLength(1)
    const refused = '1:cancel must reference current assertion issue cancel-2.'
    expect(reconcileRemaining(one, flagged, [row('cancel', 'unsupported-capability', 'cancel-1')], 'blocked').problems).toEqual([refused])
    // A retirement keeps the engine's classification, so the fidelity finding is reported.
    expect(reconcileRemaining(one, flagged, answer, 'retired').problems).toEqual([refused])
    expect(reconcileRemaining(one, new Map([['1:cancel', issue('assertion', 'cancel-2', 'execution')]]), answer, 'blocked').problems).toEqual([refused])
    expect(reconcileRemaining(one, new Map([['1:cancel', issue('assertion', 'cancel-2', 'review')]]), answer, 'blocked').problems).toEqual([refused])
    expect(reconcileRemaining(one, new Map([['1:cancel', issue('review-unavailable', 'cancel-2', 'review')]]), answer, 'blocked').problems)
      .toEqual(['1:cancel must reference current review-unavailable issue cancel-2.'])
  })
})

describe('blocked or retired outcome correction', () => {
  const one = outstanding.slice(0, 1)

  it('asks for a repair once per case, even when each failing attempt records a new issue', () => {
    const asked = new Set<string>()
    const first = outcomeCorrection(reconcileRemaining(one, new Map([['1:cancel', issue('assertion', 'cancel-1')]]), [row('cancel', 'assertion', 'cancel-1')]), asked)
    expect(first).toContain('Cases to repair: 1:cancel.')
    // The repair attempt failed and recorded cancel-2; the worker still quotes cancel-1.
    const issues = new Map([['1:cancel', issue('assertion', 'cancel-2')]])
    const stale = outcomeCorrection(reconcileRemaining(one, issues, [row('cancel', 'assertion', 'cancel-1')]), asked)
    expect(stale).toContain('1:cancel must reference current assertion issue cancel-2.')
    expect(stale).not.toContain('Cases to repair')
    expect(outcomeCorrection(reconcileRemaining(one, issues, [row('cancel', 'assertion', 'cancel-2')]), asked)).toBeUndefined()
  })

  it('lets a worker that declines the repair end on its next valid outcome', () => {
    const asked = new Set<string>()
    const issues = new Map([['1:cancel', issue('assertion', 'cancel-1', 'fidelity')]])
    const answer = [row('cancel', 'unsupported-capability', 'cancel-1')]
    expect(outcomeCorrection(reconcileRemaining(one, issues, answer, 'blocked'), asked)).toContain('Cases to repair: 1:cancel.')
    expect(outcomeCorrection(reconcileRemaining(one, issues, answer, 'blocked'), asked)).toBeUndefined()
  })

  it('never asks to repair an established external blocker', () => {
    const issues = new Map([['1:cancel', issue('preparation', 'cancel-1')]])
    expect(outcomeCorrection(reconcileRemaining(one, issues, [row('cancel', 'preparation', 'cancel-1')]), new Set())).toBeUndefined()
  })
})
