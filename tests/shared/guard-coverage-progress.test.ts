import { describe, expect, it } from 'vitest'
import { guardCoverageProgress, describeOutstandingObligations, type GuardFlowMilestone } from '@truecourse/shared'
const milestones: GuardFlowMilestone[] = [1, 2].map(order => ({ order, doc: 'spec.md', anchor: 'list', claimTitle: 'List behavior',
  proofDrivers: [order === 1 ? 'web' : 'api'], verification: { method: 'behavior', observable: 'result',
    cases: Array.from({ length: 5 }, (_, i) => ({ id: `case-${i}`, claim: `Requirement ${i}`, method: 'behavior', requires: ['browser'], conditions: [] })) } }))

describe('required obligation progress', () => {
  it('keeps five of ten cases outstanding, even when their IDs match the accepted milestone', () => {
    const progress = guardCoverageProgress(milestones, [{ milestone: 1, driver: 'web', checks: milestones[0].verification!.cases!.map(c => c.id) }])
    expect(progress.required).toHaveLength(10)
    expect(progress.authored).toHaveLength(5)
    expect(progress.outstanding).toHaveLength(5)
    expect(progress.outstanding.every(o => o.milestone === 2)).toBe(true)
    expect(progress.complete).toBe(false)
    expect(describeOutstandingObligations(progress.outstanding)).toContain('Milestone 2 / case-0')
  })
  it('combines accepted drivers without treating authored failures as passing', () => {
    const proof = milestones.map(m => ({ milestone: m.order, driver: m.proofDrivers![0], checks: m.verification!.cases!.map(c => c.id) }))
    const progress = guardCoverageProgress(milestones, proof, [proof[0]])
    expect(progress.complete).toBe(true)
    expect(progress.passing).toHaveLength(5)
    expect(progress.authored).toHaveLength(10)
    expect(guardCoverageProgress(milestones, proof.map(p => ({ ...p, driver: 'cli' }))).authored).toEqual([])
  })
  it('keeps requirements when no candidate selects them and never certifies unknown requirements', () => {
    expect(guardCoverageProgress(milestones, []).outstanding).toHaveLength(10)
    expect(guardCoverageProgress([], []).complete).toBe(false)
    const { proofDrivers, ...legacy } = milestones[0]
    expect(guardCoverageProgress([legacy], [{ milestone: 1, driver: 'web', checks: ['case-0'] }])).toMatchObject({ known: false, complete: false, authored: [] })
  })
})
