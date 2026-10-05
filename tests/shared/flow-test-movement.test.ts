/**
 * How a kept flow test's run at a new commit stands against the run it was
 * accepted on, and what an error says once one run's particulars are out of it.
 */
import { describe, expect, it } from 'vitest'
import { flowTestErrorSignature, flowTestMovement, type FlowTestStep } from '../../packages/shared/src/guard/flow-tests'

const steps = (...outcomes: Array<FlowTestStep['outcome']>): FlowTestStep[] =>
  outcomes.map((outcome, index) => ({ order: index + 1, title: `step ${index + 1}`, outcome }))
const accepted = (status: 'passing' | 'failing', ...outcomes: Array<FlowTestStep['outcome']>) => ({
  status,
  run: { ranAt: '2026-01-01T00:00:00.000Z', durationMs: 1, steps: steps(...outcomes) },
})

describe('flowTestMovement', () => {
  it('holds a passing test that passes, and moves one that does not', () => {
    const record = accepted('passing', 'passed', 'passed')
    expect(flowTestMovement(record, { outcome: 'pass', steps: steps('passed', 'passed') })).toBe('holds')
    expect(flowTestMovement(record, { outcome: 'fail', steps: steps('passed', 'failed') })).toBe('moved')
    expect(flowTestMovement(record, { outcome: 'skipped', steps: [] })).toBe('moved')
  })

  it('holds a failing test only while it fails at the step it was accepted failing at', () => {
    const record = accepted('failing', 'passed', 'failed', 'not-reached')
    expect(flowTestMovement(record, { outcome: 'fail', steps: steps('passed', 'failed') })).toBe('holds')
    expect(flowTestMovement(record, { outcome: 'fail', steps: steps('failed') })).toBe('moved')
    expect(flowTestMovement(record, { outcome: 'fail', steps: steps('passed', 'passed', 'failed') })).toBe('moved')
    expect(flowTestMovement(record, { outcome: 'pass', steps: steps('passed', 'passed', 'passed') })).toBe('now-passing')
  })

  it('reads a seed that did not hold as the seed\'s, whatever the test was accepted as', () => {
    expect(flowTestMovement(accepted('passing', 'passed'), { outcome: 'seed-failed', steps: [] })).toBe('seed-failed')
    expect(flowTestMovement(accepted('failing', 'failed'), { outcome: 'seed-failed', steps: [] })).toBe('seed-failed')
  })
})

describe('flowTestErrorSignature', () => {
  it('is the same for tests one change moved the same way', () => {
    const a = flowTestErrorSignature(
      "Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole('button', { name: 'Sign in' })\nTimeout: 5000ms",
    )
    const b = flowTestErrorSignature("\nError: expect(locator).toBeVisible() failed\n\nLocator: getByLabel('Email')")
    expect(a).toBe('Error: expect(locator).toBeVisible() failed')
    expect(b).toBe(a)
  })

  it('drops what belongs to one run: names a seed made, ids, numbers, addresses', () => {
    expect(flowTestSignaturePair('owner-m1abc9f3e2@example.com', 404, 'http://127.0.0.1:41873/api/users')).toBe(
      flowTestSignaturePair('owner-m1abd77aa01@example.com', 500, 'http://127.0.0.1:52011/api/users'),
    )
    expect(flowTestErrorSignature(undefined)).toBe('(no error text)')
  })
})

function flowTestSignaturePair(email: string, status: number, url: string): string {
  return flowTestErrorSignature(`Error: sign-up for "${email}" answered ${status} at ${url} (request 9f8e7d6c5b4a)`)
}
