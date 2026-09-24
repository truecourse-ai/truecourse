import type { GuardFlowWorkerOutcome, GuardObligation, GuardRemainingObligation } from '@truecourse/shared'

/** `source` says what observed the issue: a run, a review check, or the
 * fidelity judge flagging the scenario as not proving its claim.
 * `fidelityFlagged` says the judge flagged the case earlier in the session,
 * so a later failing run does not erase that the runner may not observe it. */
export type RepairIssue = Pick<GuardRemainingObligation, 'reasonKind' | 'evidence' | 'issueId'> & {
  source?: 'execution' | 'review' | 'fidelity'
  fidelityFlagged?: boolean
}
export const obligationKey = (o: { milestone: number; caseId?: string }) => `${o.milestone}:${o.caseId ?? ''}`

/** Checks a worker's `remaining` rows against the engine's current issue per
 * outstanding obligation. A row must name the current issue and its kind; the one
 * reclassification allowed is a blocked outcome answering an assertion issue on a
 * fidelity-flagged case as an unsupported capability (the runner cannot observe
 * what would prove the case). */
export function reconcileRemaining(
  outstanding: readonly GuardObligation[],
  issues: ReadonlyMap<string, RepairIssue>,
  supplied: readonly GuardRemainingObligation[] | undefined,
  outcomeKind?: GuardFlowWorkerOutcome['kind'],
) {
  const problems: string[] = []
  const repairable: GuardRemainingObligation[] = []
  const current = outstanding.map((o): GuardRemainingObligation => {
    const issue = issues.get(obligationKey(o))
    const row = { milestone: o.milestone, ...(o.caseId ? { caseId: o.caseId } : {}), ...currentIssue(issue) }
    if (['assertion', 'annotation', 'not-attempted'].includes(row.reasonKind)) repairable.push(row)
    const rows = supplied?.filter(r => obligationKey(r) === obligationKey(row)) ?? []
    if (rows.length !== 1) {
      problems.push(`${obligationKey(row)} needs exactly one current remaining disposition.`)
      return row
    }
    const [answer] = rows
    if (outcomeKind === 'blocked' && issue?.fidelityFlagged && issue.reasonKind === 'assertion' &&
      answer.issueId === row.issueId && answer.reasonKind === 'unsupported-capability')
      return { ...row, reasonKind: 'unsupported-capability', evidence: answer.evidence }
    if (row.issueId && (answer.issueId !== row.issueId || answer.reasonKind !== row.reasonKind))
      problems.push(`${obligationKey(row)} must reference current ${row.reasonKind} issue ${row.issueId}.`)
    else if (!row.issueId && answer.reasonKind !== 'not-attempted')
      problems.push(`${obligationKey(row)} has no engine observation establishing ${answer.reasonKind}.`)
    return row
  })
  for (const row of supplied ?? []) if (!current.some(o => obligationKey(o) === obligationKey(row)))
    problems.push(`${obligationKey(row)} is already covered or is not assigned to this worker.`)
  return { current, problems, repairable }
}

/** The correction a blocked or retired outcome draws, or undefined when it stands.
 * Each repairable case is asked for one changed candidate once per session
 * (`asked` records the ask): every failing run records a fresh issue, so a
 * demand re-armed by new evidence would never let the worker stop. Nothing is
 * asked while `wrappingUp`: the turns left cannot fit a repair and an outcome. */
export function outcomeCorrection(
  reconciled: ReturnType<typeof reconcileRemaining>,
  asked: Set<string>,
  wrappingUp = false,
): string | undefined {
  const unasked = wrappingUp ? [] : reconciled.repairable.filter(row => !asked.has(obligationKey(row)))
  if (!reconciled.problems.length && !unasked.length) return undefined
  for (const row of unasked) asked.add(obligationKey(row))
  return 'Outcome needs correction: remaining work must follow the current case-specific findings. ' +
    (unasked.length
      ? 'Submit a changed executable candidate for each case listed below before ending blocked or retired; this is asked once per case, and your next outcome is judged on its remaining rows. ' +
        `Cases to repair: ${unasked.map(obligationKey).join(', ')}.\n`
      : 'Correct the remaining rows: copy each current issueId and reasonKind. ') +
    'Preserve the entire flow contract. This correction does not grant more budget.\n' +
    reconciled.problems.map(p => p + '\n').join('') +
    'CURRENT REMAINING: ' + JSON.stringify(reconciled.current)
}

function currentIssue(issue: RepairIssue | undefined) {
  if (!issue) return { reasonKind: 'not-attempted' as const, evidence: 'No accepted proof or execution finding for this obligation.' }
  const { source, fidelityFlagged, ...publicIssue } = issue
  return publicIssue
}
