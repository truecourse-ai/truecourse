import { describe, expect, it } from 'vitest'
import {
  GuardVerificationCaseSchema,
  prerequisiteProblems,
  resolveGuardPrerequisite,
  type GuardPrerequisiteTarget,
} from '@truecourse/shared'
const target: GuardPrerequisiteTarget = {
  name: 'account',
  aliases: ['currencybeacon'],
  state: 'provided',
  registerIn: 'dependencies.local.json',
  credentialEnv: ['CURRENCYBEACON_API_KEY'],
  protectedEnv: ['CURRENCYBEACON_API_KEY', 'CURRENCYBEACON_BASE_URL'],
}
describe('case prerequisites', () => {
  it('remains backward readable and preserves explicit absent branches', () => {
    const base = { id: 'success', claim: 'Converts', method: 'behavior', requires: ['browser'], conditions: [] }
    expect(GuardVerificationCaseSchema.parse(base).prerequisites).toBeUndefined()
    expect(
      GuardVerificationCaseSchema.parse({ ...base, prerequisites: [{ dependency: 'currencybeacon', mode: 'absent' }] })
        .prerequisites![0].mode,
    ).toBe('absent')
  })
  it('resolves exact associations and refuses ambiguous or guessed aliases', () => {
    expect(resolveGuardPrerequisite('currencybeacon', [target])).toMatchObject({
      kind: 'resolved',
      target: { name: 'account' },
    })
    expect(resolveGuardPrerequisite('currencybeacon-api-key', [target]).kind).toBe('unknown')
    expect(resolveGuardPrerequisite('currencybeacon', [target, { ...target, name: 'other' }]).kind).toBe('ambiguous')
  })
  it('requires controlled absence even after registration', () => {
    const requirement = [{ dependency: 'currencybeacon', mode: 'absent' as const }]
    expect(prerequisiteProblems(requirement, [target])).toHaveLength(1)
    expect(prerequisiteProblems(requirement, [target], { CURRENCYBEACON_API_KEY: '' })).toEqual([])
  })
  it('rejects conflicting aliases and supplied-account origin overrides', () => {
    expect(
      prerequisiteProblems(
        [
          { dependency: 'account', mode: 'provided' },
          { dependency: 'currencybeacon', mode: 'absent' },
        ],
        [target],
        { CURRENCYBEACON_API_KEY: '' },
      ).some((p) => p.reason.includes('Conflicting')),
    ).toBe(true)
    expect(
      prerequisiteProblems([{ dependency: 'account', mode: 'provided' }], [target], {
        CURRENCYBEACON_BASE_URL: '${HTTP_STUB:fake}',
      }),
    ).toHaveLength(1)
  })
  it.each(['unprovided', 'incomplete'] as const)('blocks %s without secret diagnostics', (state) => {
    expect(prerequisiteProblems([{ dependency: 'currencybeacon', mode: 'provided' }], [{ ...target, state }])).toEqual([
      {
        dependency: 'account',
        registerIn: 'dependencies.local.json',
        reason: `Requires a provided account account (${state}).`,
      },
    ])
  })
})
