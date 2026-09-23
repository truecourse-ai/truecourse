/**
 * THE PREREQUISITE SHAPE — what a flow's key folds about the accounts its
 * scenarios need, and what it deliberately does not.
 *
 * A registration is the machine's, not the scenario's: which instance answered,
 * where it was registered and what its secret is reach no key. What the
 * SCENARIO is written against does — the credential variable names it may clear,
 * the services the dependency is reached through, and the one bit of
 * availability that decides between a gap and a test: whether the case can be
 * authored at all.
 */

import { describe, it, expect } from 'vitest'
import {
  flowPrerequisiteShapeFingerprint,
  partitionFlowPrerequisites,
} from '../../packages/guard-generator/src/prerequisites.js'
import type { Recipe } from '@truecourse/guard-runner'
import type { GuardFlow, GuardPrerequisiteTarget, GuardVerification } from '@truecourse/shared'

const RECIPE = { build: 'true', entry: ['node', 'cli.js'] } as Recipe

const target = (over: Partial<GuardPrerequisiteTarget> = {}): GuardPrerequisiteTarget => ({
  name: 'currencybeacon',
  aliases: [],
  state: 'provided',
  registerIn: 'externals.local.json',
  credentialEnv: ['CURRENCYBEACON_API_KEY'],
  ...over,
})

const verification: GuardVerification = {
  method: 'behavior',
  scope: 'configuration',
  observable: 'the rate is quoted',
  cases: [
    {
      id: 'quote',
      claim: 'a rate is quoted',
      method: 'behavior',
      requires: ['process'],
      conditions: [],
      prerequisites: [{ dependency: 'currencybeacon', mode: 'provided' }],
    },
  ],
}

function flow(): GuardFlow {
  return {
    id: 'quote',
    title: 'quote a rate',
    goal: 'quote',
    fingerprint: 'sha256:f',
    synthesisInputsHash: 's',
    composedOf: [],
    bindings: [],
    milestones: [
      {
        order: 1,
        doc: 'spec.md',
        anchor: 'quote',
        claimTitle: 'Quote',
        proofDrivers: ['api'],
        verification: structuredClone(verification),
      },
    ],
  } as unknown as GuardFlow
}

const shapeOf = (targets: readonly GuardPrerequisiteTarget[]): string =>
  flowPrerequisiteShapeFingerprint(flow(), targets, RECIPE)

describe('flowPrerequisiteShapeFingerprint', () => {
  it('does not move when the registration behind an authorable dependency changes', () => {
    // Provided either way: which instance answers, and where it was registered,
    // is the run's business — the scenario is written the same way regardless.
    const before = shapeOf([target()])
    expect(shapeOf([target({ registerIn: 'dependencies.local.json' })])).toBe(before)
    expect(shapeOf([target({ aliases: ['currency-beacon'] })])).toBe(before)
  })

  it('does not move between two ways of being unauthorable', () => {
    // A half-registered dependency and an unregistered one both yield the same
    // gap; the old state fold re-opened every flow on the step between them.
    expect(shapeOf([target({ state: 'incomplete' })])).toBe(shapeOf([target({ state: 'unprovided' })]))
  })

  it('moves when the dependency becomes authorable, which is what a gap waits on', () => {
    expect(shapeOf([target({ state: 'unprovided' })])).not.toBe(shapeOf([target()]))
    // The blocked flow's every case is refused, so it settles as a gap with
    // nothing authored…
    const blocked = partitionFlowPrerequisites(flow(), 'api', [target({ state: 'unprovided' })], RECIPE)
    expect(blocked.flow.milestones).toEqual([])
    expect(blocked.gaps[0]?.blocker?.kind).toBe('configuration')
    // …and registering the instance is what lets it author.
    const open = partitionFlowPrerequisites(flow(), 'api', [target()], RECIPE)
    expect(open.flow.milestones).toHaveLength(1)
    expect(open.gaps).toEqual([])
  })

  it('moves when a credential variable is renamed', () => {
    expect(shapeOf([target({ credentialEnv: ['CURRENCYBEACON_TOKEN'] })])).not.toBe(shapeOf([target()]))
  })

  it('moves when the dependency is reached through a different service', () => {
    const rates = target({ providers: [{ service: 'rates', baseUrlEnvs: ['RATES_BASE_URL'] }] })
    const quotes = target({ providers: [{ service: 'quotes', baseUrlEnvs: ['RATES_BASE_URL'] }] })
    expect(shapeOf([rates])).not.toBe(shapeOf([target()]))
    expect(shapeOf([quotes])).not.toBe(shapeOf([rates]))
  })

  it('moves when the dependency stops resolving at all', () => {
    expect(shapeOf([target({ name: 'other' })])).not.toBe(shapeOf([target()]))
  })

  it('is stable across calls and independent of target order', () => {
    const second = target({ name: 'geocoding', credentialEnv: ['GEOCODING_KEY'] })
    expect(shapeOf([target(), second])).toBe(shapeOf([second, target()]))
    expect(shapeOf([target()])).toBe(shapeOf([target()]))
  })
})
