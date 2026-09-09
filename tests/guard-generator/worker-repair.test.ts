import { describe, expect, it } from 'vitest'
import type { GuardObligation, GuardRemainingObligation } from '@truecourse/shared'
import { obligationKey, reconcileRemaining, type RepairIssue } from '../../packages/guard-generator/src/worker-repair'

const outstanding: GuardObligation[] = [
  { milestone: 1, caseId: 'cancel', claim: 'A valid draft is not saved when Cancel closes the dialog.' },
  { milestone: 1, caseId: 'total', claim: 'The controlled ledger total is exact.' },
]
const issue = (reasonKind: RepairIssue['reasonKind'], issueId: string): RepairIssue => ({ reasonKind, issueId, evidence: 'Current engine observation.' })
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

  it('keeps no-progress identity stable when the worker rephrases or omits dispositions', () => {
    const issues = new Map([['1:cancel', issue('assertion', 'cancel-2')]])
    const supplied = [row('cancel', 'assertion', 'cancel-2'), row('total', 'not-attempted')]
    const first = reconcileRemaining(outstanding, issues, supplied)
    const second = reconcileRemaining(outstanding, issues, supplied.map(r => ({ ...r, evidence: 'A completely rewritten explanation.' })))
    expect(second.identity).toBe(first.identity)
    expect(reconcileRemaining(outstanding, issues, undefined).identity).toBe(first.identity)
    expect(reconcileRemaining(outstanding, new Map([['1:cancel', { ...issue('assertion', 'cancel-2'), evidence: 'Re-rendered engine feedback.' }]]), supplied).identity).toBe(first.identity)
    // Only new engine evidence or accepted coverage earns a new correction state.
    expect(reconcileRemaining(outstanding, new Map([['1:cancel', issue('assertion', 'cancel-3')]]), supplied).identity).not.toBe(first.identity)
    expect(reconcileRemaining(outstanding.slice(1), issues, supplied.slice(1)).identity).not.toBe(first.identity)
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
})
