import { describe, expect, it } from 'vitest'
import { RecipeSchema } from '@truecourse/guard-runner'
import type { GuardScenario } from '@truecourse/shared'
import { privateAuthoringDefect, privateAuthoringProfiles } from '../../packages/guard-generator/src/private-authoring.js'

const privateProfile = {
  baseline: 'seeded', scope: 'instance', needs: ['user'], env: {},
  postgres: { isolation: 'database', urlEnvs: ['DATABASE_URL'] },
  baselineChecks: [{ path: '/users', counts: { count: 1 } }],
  seed: { script: 'seed.mjs', provides: { fixtures: {}, credentials: {} } },
  verify: { script: 'verify.mjs' }, cleanup: { script: 'cleanup.mjs' },
}

describe('private authoring eligibility', () => {
  const locals = new Set(['user'])
  it('admits declared local Postgres preparation, not legacy or supplied profiles', () => {
    const recipe = RecipeSchema.parse({ build: 'true', api: { serve: ['node', 'server.mjs'] }, preparations: {
      private: privateProfile,
      supplied: { ...privateProfile, needs: ['stripe'] },
      undeclared: { ...privateProfile, needs: undefined },
      unchecked: { ...privateProfile, baselineChecks: undefined },
      file: { ...privateProfile, postgres: undefined, env: { DATABASE_URL: '${directory}/db' } },
    } })
    expect([...privateAuthoringProfiles(recipe, locals)]).toEqual(['private'])
  })

  it('requires private preparation even for drafts that omit world: mutates', () => {
    expect(privateAuthoringDefect({ steps: [] } as unknown as GuardScenario, new Set(['private']), locals))
      .toMatch(/select an eligible/)
  })

  it.each([
    { needs: ['stripe'] },
    { prerequisites: [{ dependency: 'stripe', mode: 'provided' }] },
    { steps: [{ request: { path: '/${supplied:stripe.account}' } }] },
  ])('refuses supplied bindings on a prepared scenario: %j', extra => {
    const scenario = { steps: [], setup: { preparation: 'private' }, ...extra } as unknown as GuardScenario
    expect(privateAuthoringDefect(scenario, new Set(['private']), locals)).toMatch(/stripe/)
  })

  it('allows only the selected eligible profile and local dependencies', () => {
    const scenario = { steps: [], setup: { preparation: 'private' }, needs: ['user'] } as unknown as GuardScenario
    expect(privateAuthoringDefect(scenario, new Set(['private']), locals)).toBeUndefined()
    expect(privateAuthoringDefect(scenario, new Set(), locals)).toMatch(/select an eligible/)
  })
})
