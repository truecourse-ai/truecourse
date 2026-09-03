/**
 * The api driver's process-lifecycle step kinds (`boot`/`signal`/`logs`): schema
 * shape, the mutual exclusions, and how they render in the step view the
 * dashboard shows.
 */

import { describe, it, expect } from 'vitest'
import {
    GuardScenarioSchema,
  GuardApiStepSchema,
  describeGuardScenarioSteps,
  isApiBootStep,
  isApiLogsStep,
  isApiRequestStep,
  isApiSignalStep,
} from '@truecourse/shared'

const binds = [{ doc: 'docs/a.md', section: 'a/b', fingerprint: 'sha256:x' }]

function scenario(steps: unknown[]): unknown {
  return { id: 's.api.1', title: 't', binds, steps, normalize: [] }
}

describe('api lifecycle steps — schema', () => {
  it('is ADDITIVE: request steps parse unchanged', () => {
    const step = GuardApiStepSchema.parse({ request: { method: 'GET', path: '/x' }, expect: { status: 200 } })
    expect(isApiRequestStep(step)).toBe(true)
    expect(isApiBootStep(step)).toBe(false)
  })

  it('accepts a bare boot, a boot with env, and both expectation shapes', () => {
    expect(isApiBootStep(GuardApiStepSchema.parse({ boot: {} }))).toBe(true)
    expect(GuardApiStepSchema.parse({ boot: { env: { PORTX: '1' } } })).toEqual({ boot: { env: { PORTX: '1' } } })
    expect(GuardApiStepSchema.parse({ boot: { expect: { ready: true } } })).toBeTruthy()
    expect(
      GuardApiStepSchema.parse({ boot: { expect: { exitCode: 1, stderrContains: ['bad config'] } } }),
    ).toBeTruthy()
  })

  it('refuses a boot that expects BOTH readiness and an exit', () => {
    expect(() => GuardApiStepSchema.parse({ boot: { expect: { ready: true, exitCode: 1 } } })).toThrow()
  })

  it('refuses an empty boot expectation and a non-literal `ready`', () => {
    expect(() => GuardApiStepSchema.parse({ boot: { expect: {} } })).toThrow()
    expect(() => GuardApiStepSchema.parse({ boot: { expect: { ready: false } } })).toThrow()
  })

  it('accepts the two signals only, with an optional exit expectation', () => {
    expect(isApiSignalStep(GuardApiStepSchema.parse({ signal: { name: 'SIGTERM' } }))).toBe(true)
    expect(GuardApiStepSchema.parse({ signal: { name: 'SIGINT', expect: { exitCode: 0, withinMs: 500 } } })).toBeTruthy()
    expect(() => GuardApiStepSchema.parse({ signal: { name: 'SIGKILL' } })).toThrow()
    expect(() => GuardApiStepSchema.parse({ signal: { name: 'SIGTERM', expect: { withinMs: 0 } } })).toThrow()
  })

  it('accepts both log matcher forms and rejects an unknown stream', () => {
    expect(isApiLogsStep(GuardApiStepSchema.parse({ logs: { stream: 'stdout', match: 'x' } }))).toBe(true)
    expect(GuardApiStepSchema.parse({ logs: { stream: 'stderr', match: { pattern: '^a\\d+' } } })).toBeTruthy()
    expect(() => GuardApiStepSchema.parse({ logs: { stream: 'stdlog', match: 'x' } })).toThrow()
    expect(() => GuardApiStepSchema.parse({ logs: { stream: 'stdout' } })).toThrow()
    expect(() => GuardApiStepSchema.parse({ logs: { stream: 'stdout', match: 'x', count: -1 } })).toThrow()
  })

  it('every kind carries the optional milestone, and nothing else', () => {
    expect(GuardApiStepSchema.parse({ boot: {}, milestone: 2 }).milestone).toBe(2)
    expect(GuardApiStepSchema.parse({ signal: { name: 'SIGTERM' }, milestone: 1 }).milestone).toBe(1)
    expect(() => GuardApiStepSchema.parse({ boot: {}, repeat: 2 })).toThrow()
    expect(() => GuardApiStepSchema.parse({ boot: {}, request: { method: 'GET', path: '/x' } })).toThrow()
  })

  it('a whole scenario mixes request and lifecycle steps', () => {
    const parsed = GuardScenarioSchema.parse(
      scenario([
        { boot: { env: { LOG_LEVEL: 'debug' } } },
        { request: { method: 'GET', path: '/x' }, expect: { status: 200 } },
        { logs: { stream: 'stdout', match: 'GET /x', sinceLastStep: true, count: 1 } },
        { signal: { name: 'SIGTERM', expect: { exitCode: 0 } } },
      ]),
    )
    expect(parsed.steps).toHaveLength(4)
  })
})

describe('api lifecycle steps — the step view', () => {
  it('renders each kind as an action plus what it asserts', () => {
    const views = describeGuardScenarioSteps(
      scenario([
        { boot: { env: { LOG_LEVEL: 'debug' } }, milestone: 1 },
        { boot: { expect: { exitCode: 1, stderrContains: ['invalid PORT'] } } },
        { signal: { name: 'SIGTERM', expect: { exitCode: 0 } } },
        { logs: { stream: 'stdout', match: { pattern: '^GET' }, sinceLastStep: true, count: 1 } },
        { request: { method: 'GET', path: '/x' }, expect: { status: 200 } },
      ]),
    )
    expect(views[0]).toMatchObject({
      n: 1,
      command: 'boot the server',
      expectation: 'becomes healthy',
      env: ['LOG_LEVEL=debug'],
      milestone: 1,
    })
    expect(views[1].expectation).toBe('exits 1 · stderr contains “invalid PORT”')
    expect(views[2]).toMatchObject({ command: 'signal SIGTERM', expectation: 'exits 0' })
    expect(views[3]).toMatchObject({
      command: 'read server stdout',
      expectation: 'exactly 1 line matching /^GET/ since the previous step',
    })
    expect(views[4]).toMatchObject({ command: 'GET /x', expectation: 'status 200' })
  })
})
