import { describe, expect, it } from 'vitest'
import { GuardExpectedRedSchema, GuardFailureDetailSchema, GuardFailureObservationSchema } from '@truecourse/shared'

const target = { version: 1, kind: 'web-target', assertion: 'visible:0', page: 'guard-server://web/settings', operation: 'to see', locator: { role: 'button', name: 'Save' }, matchCount: 0, visibility: 'hidden', reason: 'absent' }

describe('versioned failure observations', () => {
  it('keeps legacy failures and expected reds readable', () => {
    expect(GuardFailureDetailSchema.parse({ step: 1, expected: 'Save', actual: 'absent' }).observation).toBeUndefined()
    expect(GuardExpectedRedSchema.parse({ step: 1, predictedActual: 'absent', verdict: 'code-drift', brief: 'Save is missing' }).observation).toBeUndefined()
  })
  it('strictly validates versioned producer evidence', () => {
    expect(GuardFailureObservationSchema.safeParse(target).success).toBe(true)
    for (const change of [{ version: 2 }, { matchCount: -1 }, { injected: true }, { reason: 'timeout' }]) {
      expect(GuardFailureObservationSchema.safeParse({ ...target, ...change }).success).toBe(false)
    }
  })
  it('rejects whitespace-only predictions', () => {
    expect(GuardExpectedRedSchema.safeParse({ step: 1, predictedActual: ' \n ', verdict: 'code-drift', brief: 'Missing' }).success).toBe(false)
  })
})
