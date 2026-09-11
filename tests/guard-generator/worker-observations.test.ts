import { describe, expect, it } from 'vitest'
import type { GuardExpectedRed, GuardFailureObservation, GuardScenarioResult } from '@truecourse/shared'
import { WorkerObservations, redObservationMismatch } from '../../packages/guard-generator/src/worker-observations.js'

const observation: GuardFailureObservation = {
  version: 1, kind: 'web-target', assertion: 'visible:0', page: 'guard-server://web/settings',
  operation: 'to see', locator: { role: 'button', name: 'Save' }, matchCount: 0, visibility: 'hidden', reason: 'absent',
}
const result = (over: Partial<GuardScenarioResult> = {}): GuardScenarioResult => ({
  id: 'test', title: 'test', binds: { doc: 'spec.md', section: 'save', fingerprint: 'spec' },
  outcome: 'fail', durationMs: 0,
  failure: { step: 1, expected: 'Save visible', actual: 'no Save button', observation }, ...over,
})
const red = (over: Partial<GuardExpectedRed> = {}): GuardExpectedRed => ({
  step: 1, predictedActual: 'no Save button', verdict: 'code-drift', brief: 'Save missing', ...over,
})

describe('worker-owned execution observations', () => {
  it('binds a token to exact candidate bytes, step and task; never trusts model evidence', () => {
    const worker = new WorkerObservations('web')
    const id = worker.record('draft', result())!
    expect(id).toBeTruthy()
    expect(worker.resolve('draft', [red({ observationId: id })])).toEqual({ expectedReds: [red({ observation })] })
    expect(worker.resolve('draft ', [red({ observationId: id })])).toHaveProperty('error')
    expect(worker.resolve('draft', [red({ observationId: id, step: 2 })])).toHaveProperty('error')
    expect(new WorkerObservations('web').resolve('draft', [red({ observationId: id })])).toHaveProperty('error')
    expect(worker.resolve('draft', [red({ observation })])).toHaveProperty('error')
  })

  it('bounds retained observations and clears them on completion', () => {
    const worker = new WorkerObservations('web', 2)
    const first = worker.record('one', result())!
    worker.record('two', result())
    const last = worker.record('three', result())!
    expect(worker.resolve('one', [red({ observationId: first })])).toHaveProperty('error')
    expect(worker.resolve('three', [red({ observationId: last })])).toHaveProperty('expectedReds')
    worker.clear()
    expect(worker.resolve('three', [red({ observationId: last })])).toHaveProperty('error')
  })

  it('does not mint evidence for setup failure, unsafe evidence or other surfaces', () => {
    const worker = new WorkerObservations('web')
    expect(worker.record('draft', result({ preparationFailure: { profile: 'empty', stage: 'prepare' } }))).toBeUndefined()
    expect(worker.record('draft', result({ failure: { ...result().failure!, observationUnavailable: 'redacted subject' } }))).toBeUndefined()
    expect(new WorkerObservations('api').record('draft', result())).toBeUndefined()
  })

  it('rejects duplicate first-red and empty predictions on every surface', () => {
    const worker = new WorkerObservations('cli')
    expect(worker.resolve('draft', [red(), red()])).toHaveProperty('error')
    expect(worker.resolve('draft', [red({ predictedActual: ' \n ' })])).toHaveProperty('error')
    expect(worker.resolve('draft', [red({ predictedActual: '  absent  ' })])).toEqual({ expectedReds: [red({ predictedActual: 'absent' })] })
    expect(redObservationMismatch(result(), red({ predictedActual: ' ' }))).toBeTruthy()
  })

  it('uses typed evidence despite wording changes and fails closed on lost or changed evidence', () => {
    expect(redObservationMismatch(result(), red({ observation, predictedActual: 'nothing matches Save' }))).toBeUndefined()
    expect(redObservationMismatch(result(), red())).toContain('observationId')
    expect(redObservationMismatch(result({ failure: { ...result().failure!, observation: undefined } }), red({ observation }))).toBeTruthy()
    expect(redObservationMismatch(result(), red({ observation: { ...observation, page: 'guard-server://web/login' } }))).toBeTruthy()
    expect(redObservationMismatch(result({ failure: { ...result().failure!, observationUnavailable: 'unsafe evidence' } }), red({ observation }))).toBeTruthy()
  })

  it('retains legacy prose matching for unsupported failures', () => {
    const legacy = result({ failure: { step: 1, expected: 'exit 0', actual: 'exit code 7' } })
    expect(redObservationMismatch(legacy, red({ predictedActual: 'code 7' }))).toBeUndefined()
    expect(redObservationMismatch(legacy, red({ predictedActual: 'code 8' }))).toBeTruthy()
  })
})
