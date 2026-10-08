import { describe, expect, it } from 'vitest'
import { describeOutstandingObligations, guardCoverageProgress, type GuardFlowMilestone } from '@truecourse/shared'

const milestones: GuardFlowMilestone[] = [1, 2].map(order => ({
  order, doc: 'spec.md', claimId: `claim::${order}`, claimTitle: `Requirement ${order}`, sentences: [`s${order}`],
}))

describe('guardCoverageProgress', () => {
  it('counts a milestone as proved by any surface that asserts it', () => {
    const progress = guardCoverageProgress(milestones, [{ milestone: 1, driver: 'web' }])
    expect(progress.authored.map(o => o.milestone)).toEqual([1])
    expect(progress.outstanding.map(o => o.milestone)).toEqual([2])
    expect(progress).toMatchObject({ known: true, complete: false })
    expect(guardCoverageProgress(milestones, [{ milestone: 1, driver: 'web' }, { milestone: 2, driver: 'api' }]).complete).toBe(true)
  })
  it('keeps passing proof separate from authored proof, and knows nothing of an empty flow', () => {
    const progress = guardCoverageProgress(milestones, [{ milestone: 1, driver: 'web' }, { milestone: 2, driver: 'web' }], [{ milestone: 2, driver: 'web' }])
    expect(progress.passing.map(o => o.milestone)).toEqual([2])
    expect(guardCoverageProgress([], [])).toMatchObject({ known: false, complete: false })
  })
  it('describes the outstanding milestones with their claims', () => {
    const { outstanding } = guardCoverageProgress(milestones, [])
    expect(describeOutstandingObligations(outstanding)).toBe('- Milestone 1: Requirement 1\n- Milestone 2: Requirement 2')
  })
})
