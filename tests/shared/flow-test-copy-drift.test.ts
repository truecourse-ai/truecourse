/**
 * Copy drift on a flow test's outcome: a mark a test with a spec may carry,
 * kept in one order however it was reported, and what it makes of a flow's
 * status: a test that passes with it leaves its flow partially succeeded.
 */
import { describe, expect, it } from 'vitest'
import { guardFlowPlainStatus } from '../../packages/shared/src/guard/dashboard'
import { FlowTestOutcomeSchema, orderCopyDrift } from '../../packages/shared/src/guard/flow-tests'

const drift = [{ step: 2, documented: 'Update', observed: 'Edit details' }]

describe('copy drift on an outcome', () => {
  it('rides on a passing or a failing test, and never on a blocked flow', () => {
    expect(FlowTestOutcomeSchema.safeParse({ status: 'passing', summary: 's', copyDrift: drift }).success).toBe(true)
    expect(
      FlowTestOutcomeSchema.safeParse({ status: 'failing', summary: 's', disagreement: { documented: 'd', observed: 'o' }, copyDrift: drift }).success,
    ).toBe(true)

    const blocked = FlowTestOutcomeSchema.safeParse({ status: 'blocked', summary: 's', blockedBy: 'b', blockedOn: 'o', copyDrift: drift })
    expect(blocked.success).toBe(false)
    expect(blocked.error?.issues[0]?.path).toEqual(['copyDrift'])
  })

  it('is ordered by step, then by the documented name', () => {
    const reported = [
      { step: 2, documented: 'Update', observed: 'Edit details' },
      { step: 1, documented: 'Danger Zone', observed: 'Account' },
      { step: 2, documented: 'Remove', observed: 'Delete' },
    ]
    expect(orderCopyDrift(reported).map((d) => `${d.step} ${d.documented}`)).toEqual(['1 Danger Zone', '2 Remove', '2 Update'])
  })
})

describe('a flow whose test met copy drift', () => {
  const proven = { status: 'pass', bucket: 'guarded', findings: 0 } as const

  it('is partially succeeded when the test passes, and succeeded when it met none', () => {
    expect(guardFlowPlainStatus({ ...proven, test: { status: 'passing', copyDrift: drift } })).toBe('partially-succeeded')
    expect(guardFlowPlainStatus({ ...proven, test: { status: 'passing' } })).toBe('succeeded')
    expect(guardFlowPlainStatus({ ...proven, test: { status: 'passing', copyDrift: [] } })).toBe('succeeded')
    expect(guardFlowPlainStatus(proven)).toBe('succeeded')
  })

  it('is failed when the test fails, whatever it met on the way', () => {
    expect(guardFlowPlainStatus({ status: 'fail', bucket: 'guarded', findings: 0, test: { status: 'failing', copyDrift: drift } })).toBe('failed')
  })
})
