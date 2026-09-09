import type { GuardCaseEvidence, GuardEvidenceProofContext, GuardScenario } from '@truecourse/shared'

/** Sanitized shape of the September 9 empty-ledger review-reference incident. */
export const emptyLedgerEvidenceContext: GuardEvidenceProofContext = {
  milestones: [{ order: 3, doc: 'spec.md', anchor: 'empty-ledger', claimTitle: 'The pristine ledger shows its empty presentation.',
    proofDrivers: ['web'], verification: { scope: 'web', method: 'behavior', observable: 'Pristine empty ledger text',
      cases: [{ id: 'empty-ledger-state', claim: 'An empty ledger shows the empty heading and add-expense guidance.',
        method: 'behavior', requires: ['browser'], conditions: ['fresh-state'] }] } }],
  steps: [
    { driver: 'web', navigate: '/' },
    { driver: 'web', expect: { visible: { role: 'heading', name: 'Your expenses', exact: true } } },
    { driver: 'web', expect: { visible: { role: 'button', name: 'Add expense', exact: true } } },
    { driver: 'web', expect: { count: { target: { role: 'row', name: 'Description Amount Date Category Actions', exact: true }, equals: 1 } } },
    { driver: 'web', expect: { visible: { text: '$0.00', exact: true } } },
    { driver: 'web', milestone: 3, checks: ['empty-ledger-state'], expect: { visible: { text: 'No expenses yet', exact: true } } },
    { driver: 'web', milestone: 3, checks: ['empty-ledger-state'], expect: { visible: { text: 'Add your first expense to get started.', exact: true } } },
    { driver: 'web', fill: { role: 'textbox', name: 'Search', exact: true }, value: 'missing' },
    { driver: 'web', click: { role: 'button', name: 'Search', exact: true } },
    { driver: 'web', expect: { visible: { text: 'No matching expenses', exact: true } } },
    { driver: 'web', expect: { hidden: { text: 'Add your first expense to get started.', exact: true } } },
  ] satisfies GuardScenario['steps'],
}
export const invalidEmptyLedgerEvidence: GuardCaseEvidence[] = [{ milestone: 3, caseId: 'empty-ledger-state',
  steps: [6, 7, 10, 11], reason: 'The pristine empty ledger heading and guidance are asserted.' }]
export const correctedEmptyLedgerEvidence: GuardCaseEvidence[] = [{ ...invalidEmptyLedgerEvidence[0], steps: [6, 7] }]
