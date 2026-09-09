import type { GuardObligation, GuardRemainingObligation } from '@truecourse/shared'

export type RepairIssue = Pick<GuardRemainingObligation, 'reasonKind' | 'evidence' | 'issueId'> & { source?: 'execution' | 'review' }
export const obligationKey = (o: { milestone: number; caseId?: string }) => `${o.milestone}:${o.caseId ?? ''}`

/** A bounded corrective request is keyed by engine state, never by the worker's
 * changing prose. An unchanged failure cannot obtain endless fresh attempts. */
export function reconcileRemaining(
  outstanding: readonly GuardObligation[],
  issues: ReadonlyMap<string, RepairIssue>,
  supplied: readonly GuardRemainingObligation[] | undefined,
) {
  const current = outstanding.map(o => ({ milestone: o.milestone, ...(o.caseId ? { caseId: o.caseId } : {}),
    ...currentIssue(issues.get(obligationKey(o))) }))
  const problems: string[] = []
  for (const row of current) {
    const rows = supplied?.filter(r => obligationKey(r) === obligationKey(row)) ?? []
    if (rows.length !== 1) problems.push(`${obligationKey(row)} needs exactly one current remaining disposition.`)
    else if (row.issueId && (rows[0].issueId !== row.issueId || rows[0].reasonKind !== row.reasonKind))
      problems.push(`${obligationKey(row)} must reference current ${row.reasonKind} issue ${row.issueId}.`)
    else if (!row.issueId && rows[0].reasonKind !== 'not-attempted')
      problems.push(`${obligationKey(row)} has no engine observation establishing ${rows[0].reasonKind}.`)
  }
  for (const row of supplied ?? []) if (!current.some(o => obligationKey(o) === obligationKey(row)))
    problems.push(`${obligationKey(row)} is already covered or is not assigned to this worker.`)
  const repairable = current.filter(r => ['assertion', 'annotation', 'not-attempted'].includes(r.reasonKind))
  const identity = JSON.stringify(current.map(r => [obligationKey(r), r.reasonKind, r.issueId ?? null]))
  return { current, problems, repairable, identity }
}

function currentIssue(issue: RepairIssue | undefined) {
  if (!issue) return { reasonKind: 'not-attempted' as const, evidence: 'No accepted proof or execution finding for this obligation.' }
  const { source, ...publicIssue } = issue
  return publicIssue
}
