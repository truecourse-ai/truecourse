/**
 * The process-lifecycle step kinds (`boot`/`signal`/`logs`) on BOTH drivers:
 * schema shape, the mutual exclusions, and how they render in the step view the
 * dashboard shows. The api boot is health-path readiness; the cli boot starts a
 * managed service whose readiness is a stdout/stderr line.
 */

import { describe, it, expect } from 'vitest'
import {
  GUARD_FORMAT_VERSION,
  GuardApiScenarioSchema,
  GuardApiStepSchema,
  GuardCliScenarioSchema,
  GuardCliStepSchema,
  describeGuardScenarioSteps,
  firstInvalidMatchPattern,
  isApiBootStep,
  isApiLogsStep,
  isApiRequestStep,
  isApiSignalStep,
  isCliBootStep,
  isCliLogsStep,
  isCliRunStep,
  isCliSignalStep,
} from '@truecourse/shared'

const binds = [{ doc: 'docs/a.md', section: 'a/b', fingerprint: 'sha256:x' }]

function scenario(steps: unknown[]): unknown {
  return { guard: 2, id: 's.api.1', title: 't', binds, driver: 'api', steps, normalize: [] }
}

describe('api lifecycle steps — schema', () => {
  it('is ADDITIVE: the format version does not move, request steps parse unchanged', () => {
    expect(GUARD_FORMAT_VERSION).toBe(2)
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
    const parsed = GuardApiScenarioSchema.parse(
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

// --- The cli driver's MANAGED-SERVICE lifecycle -------------------------------

function cliScenario(steps: unknown[]): unknown {
  return { guard: 2, id: 's.cli.1', title: 't', binds, driver: 'cli', steps, normalize: [] }
}

describe('cli lifecycle steps — schema', () => {
  it('is ADDITIVE: run steps parse unchanged, the format version does not move', () => {
    expect(GUARD_FORMAT_VERSION).toBe(2)
    const step = GuardCliStepSchema.parse({ run: ['check'], expect: { exit: 0 } })
    expect(isCliRunStep(step)).toBe(true)
    expect(isCliBootStep(step)).toBe(false)
  })

  it('accepts a boot with argv + readiness (both matcher forms), env optional', () => {
    const boot = GuardCliStepSchema.parse({
      boot: { run: ['serve'], ready: { stream: 'stdout', match: 'listening' } },
    })
    expect(isCliBootStep(boot)).toBe(true)
    expect(
      GuardCliStepSchema.parse({
        boot: { run: ['serve', '--quiet'], env: { LOG: '1' }, ready: { stream: 'stderr', match: { pattern: 'up \\d+' }, withinMs: 5000 } },
      }),
    ).toBeTruthy()
  })

  it('refuses a boot without `ready` — readiness is the whole point of the shape', () => {
    expect(() => GuardCliStepSchema.parse({ boot: { run: ['serve'] } })).toThrow()
    expect(() => GuardCliStepSchema.parse({ boot: { run: ['serve'], ready: { stream: 'stdout' } } })).toThrow()
    expect(() => GuardCliStepSchema.parse({ boot: { run: ['serve'], ready: { stream: 'stdlog', match: 'x' } } })).toThrow()
  })

  it('signal and logs are the api shapes — same words for the same concepts', () => {
    expect(isCliSignalStep(GuardCliStepSchema.parse({ signal: { name: 'SIGTERM', expect: { exitCode: 0 } } }))).toBe(true)
    expect(isCliLogsStep(GuardCliStepSchema.parse({ logs: { stream: 'stdout', match: 'x', sinceLastStep: true, count: 2 } }))).toBe(true)
    expect(() => GuardCliStepSchema.parse({ signal: { name: 'SIGKILL' } })).toThrow()
  })

  it('a whole cli scenario mixes run and lifecycle steps', () => {
    const parsed = GuardCliScenarioSchema.parse(
      cliScenario([
        { boot: { run: ['serve'], ready: { stream: 'stdout', match: 'listening' } }, milestone: 1 },
        { run: ['status'], expect: { exit: 0 }, milestone: 2 },
        { logs: { stream: 'stdout', match: 'handled', sinceLastStep: true } },
        { signal: { name: 'SIGTERM', expect: { exitCode: 0 } }, milestone: 3 },
      ]),
    )
    expect(parsed.steps).toHaveLength(4)
  })

  it('rejects an uncompilable regex in `boot.ready.match` and cli `logs.match`', () => {
    const bad = firstInvalidMatchPattern([
      { boot: { run: ['serve'], ready: { stream: 'stdout', match: { pattern: '(' } } } },
    ] as never)
    expect(bad).toMatchObject({ step: 1, where: 'boot.ready.match', pattern: '(' })
    const badLogs = firstInvalidMatchPattern([
      { run: [], expect: {} },
      { logs: { stream: 'stdout', match: { pattern: '[' } } },
    ] as never)
    expect(badLogs).toMatchObject({ step: 2, where: 'logs.match' })
  })
})

describe('cli lifecycle steps — the step view', () => {
  it('renders each kind as an action plus what it asserts', () => {
    const views = describeGuardScenarioSteps(
      cliScenario([
        { boot: { run: ['serve', '--quiet'], env: { LOG: '1' }, ready: { stream: 'stdout', match: 'listening' } }, milestone: 1 },
        { run: ['status'], expect: { exit: 0 } },
        { logs: { stream: 'stdout', match: { pattern: 'handled #\\d+' }, sinceLastStep: true, count: 1 } },
        { signal: { name: 'SIGTERM', expect: { exitCode: 0, withinMs: 5000 } } },
      ]),
    )
    expect(views[0]).toMatchObject({
      n: 1,
      command: 'start the service: serve --quiet',
      expectation: 'stdout prints a line matching “listening”',
      env: ['LOG=1'],
      milestone: 1,
    })
    expect(views[1]).toMatchObject({ command: 'status', expectation: 'exit 0' })
    expect(views[2]).toMatchObject({
      command: 'read service stdout',
      expectation: 'exactly 1 line matching /handled #\\d+/ since the previous step',
    })
    expect(views[3]).toMatchObject({ command: 'signal SIGTERM', expectation: 'exits 0 · within 5000ms' })
  })
})
