import { describe, it, expect } from 'vitest'
import {
  GuardScenarioSchema,
  GuardApiStepSchema,
  GuardStepSchema,
    guardScenarioDrivers,
  isApiServerScenario,
  runnableDriverIds,
  awaitingDriverIds,
  isRunnableDriver,
} from '@truecourse/shared'

const BINDS = [{ doc: 'docs/api.md', section: 'todos/create', fingerprint: 'sha256:abc' }]

const API_SCENARIO = {
  id: 'todo-lifecycle.api.1',
  title: 'POST /todos creates a todo',
  flow: { id: 'todo-lifecycle', fingerprint: 'sha256:flow' },
  interface: { path: ['api/create-todo'], fingerprints: ['sha256:interface'] },
  binds: BINDS,
  steps: [
    {
      request: { method: 'POST', path: '/todos', json: { title: 'x' } },
      capture: { id: 'id' },
      expect: { status: 201, json: { title: { equals: 'x' } } },
    },
    { request: { method: 'GET', path: '/todos/${id}' }, expect: { status: 200 } },
  ],
}

describe('guard scenario schema — api driver', () => {
  it('carries an optional `server` — the api-server binding, in the shared envelope', () => {
    expect(GuardScenarioSchema.safeParse({ ...API_SCENARIO, server: 'api-v2' }).success).toBe(true)
    // Absent is the pre-multi-server meaning: the recipe's default server.
    const bare = GuardScenarioSchema.safeParse(API_SCENARIO)
    expect(bare.success).toBe(true)
    if (bare.success) expect(bare.data.server).toBeUndefined()
  })

  it('drops a LEGACY scenario-level `driver` key — one schema, drivers on the steps', () => {
    // The field was retired on 2026-08-12; corpora committed before it still load,
    // and what they declared is thrown away rather than believed.
    for (const legacy of ['api', 'cli', 'web']) {
      const parsed = GuardScenarioSchema.safeParse({ ...API_SCENARIO, driver: legacy })
      expect(parsed.success).toBe(true)
      if (parsed.success) {
        expect('driver' in parsed.data).toBe(false)
        // …and the drivers it really exercises come from the steps, whatever it said.
        expect(guardScenarioDrivers(parsed.data)).toEqual(['api'])
      }
    }
  })

  it('the api driver is runnable in the registry', () => {
    expect(runnableDriverIds).toEqual(['cli', 'api', 'web'])
    // desktop + mobile are recorded interface types, appended last (the enum order
    // is fingerprinted into the extraction prompt).
    expect(awaitingDriverIds).toEqual(['tui', 'library', 'desktop', 'mobile'])
    expect(isRunnableDriver('api')).toBe(true)
  })

  it('parses a full api scenario (envelope + api verbs)', () => {
    const parsed = GuardScenarioSchema.parse(API_SCENARIO)
    expect(isApiServerScenario(parsed)).toBe(true)
    expect(guardScenarioDrivers(parsed)).toEqual(['api'])
    expect(parsed.normalize).toEqual([])
  })

  it('the `request` verb crosses into the sandbox; the LIFECYCLE verbs do not', () => {
    // A sandbox scenario may drive the UI and then read the structured answer over
    // HTTP, so `request` sits in one list beside cli steps — and the scenario is no
    // longer an api-server one, because not every step is an api verb.
    const mixed = GuardScenarioSchema.safeParse({
      ...API_SCENARIO,
      steps: [{ run: ['--version'], expect: { exit: 0 } }, ...API_SCENARIO.steps],
    })
    expect(mixed.success).toBe(true)
    if (mixed.success) {
      expect(isApiServerScenario(mixed.data)).toBe(false)
      expect(guardScenarioDrivers(mixed.data)).toEqual(['cli', 'api'])
    }
    // `boot`/`signal`/`logs` drive the server PROCESS the api driver owns; in a
    // sandbox the served surface's lifecycle is the sandbox's, not a step's.
    for (const step of [{ boot: {} }, { signal: { name: 'SIGTERM' } }, { logs: { stream: 'stdout', match: 'up' } }]) {
      const withCli = GuardScenarioSchema.safeParse({
        ...API_SCENARIO,
        steps: [{ run: ['--version'], expect: { exit: 0 } }, step],
      })
      expect(withCli.success).toBe(false)
      // Alone, in an all-api-verb scenario, the same step is exactly right.
      expect(GuardScenarioSchema.safeParse({ ...API_SCENARIO, steps: [step] }).success).toBe(true)
    }
  })

  it('a step may capture from response HEADERS (additive, no format bump)', () => {
    const step = {
      request: { method: 'GET', path: '/redirect' },
      captureHeaders: { next: 'Location', tok: 'x-auth-token' },
      expect: { status: 302 },
    }
    expect(GuardApiStepSchema.parse(step).captureHeaders).toEqual({ next: 'Location', tok: 'x-auth-token' })
    // Values are header NAMES (strings).
    expect(() =>
      GuardApiStepSchema.parse({ ...step, captureHeaders: { next: 1 } }),
    ).toThrow()
    // A scenario predating the field parses unchanged.
    expect(() => GuardScenarioSchema.parse(API_SCENARIO)).not.toThrow()
  })

  it('refuses a teardown on the api-server path — that server\'s lifecycle is the runner\'s', () => {
    const withTeardown = {
      ...API_SCENARIO,
      teardown: [{ request: { method: 'DELETE', path: '/todos/1' }, expect: { status: 204 } }],
    }
    expect(GuardScenarioSchema.safeParse(withTeardown).success).toBe(false)
  })

  it('a request carries body OR json, never both', () => {
    const step = {
      request: { method: 'POST', path: '/x', body: 'raw', json: { a: 1 } },
      expect: { status: 200 },
    }
    expect(() => GuardApiStepSchema.parse(step)).toThrow(/not both/)
  })

  it('paths must start with /', () => {
    const step = { request: { method: 'GET', path: 'todos' }, expect: {} }
    expect(() => GuardApiStepSchema.parse(step)).toThrow(/start with/)
  })

  it('a json matcher needs at least one clause', () => {
    const step = { request: { method: 'GET', path: '/x' }, expect: { json: { id: {} } } }
    expect(() => GuardApiStepSchema.parse(step)).toThrow(/needs one of/)
  })

  // B5 — response-schema conformance assertion.
  it('parses `expect.schema: true` (response-conformance assertion)', () => {
    const step = { request: { method: 'GET', path: '/todos' }, expect: { status: 200, schema: true } }
    const parsed = GuardApiStepSchema.parse(step)
    expect(parsed.expect.schema).toBe(true)
  })

  it('an api expect with no schema field still parses (additive, old scenarios unchanged)', () => {
    const parsed = GuardScenarioSchema.parse(API_SCENARIO)
    expect(isApiServerScenario(parsed)).toBe(true)
    expect((parsed.steps[0] as { expect: { schema?: boolean } }).expect.schema).toBeUndefined()
  })

  it('still rejects an unknown expect key (strict envelope preserved)', () => {
    const step = { request: { method: 'GET', path: '/x' }, expect: { status: 200, bogus: true } }
    expect(() => GuardApiStepSchema.parse(step)).toThrow()
  })
})

describe('guard scenario envelope v3', () => {
  const CLI_SCENARIO = {
    id: 'todo-lifecycle.cli.1',
    title: 'todos are added and listed',
    flow: { id: 'todo-lifecycle', fingerprint: 'sha256:flow' },
    interface: { path: ['cli/todos-add', 'cli/todos-list'], fingerprints: ['sha256:a', 'sha256:b'] },
    binds: [
      { doc: 'docs/cli.md', section: 'todos/add', fingerprint: 'sha256:add' },
      { doc: 'docs/cli.md', section: 'todos/list', fingerprint: 'sha256:list' },
    ],
    steps: [
      { run: ['todos', 'add', 'milk'], expect: { exit: 0 }, milestone: 1 },
      { run: ['todos', 'list'], expect: { exit: 0, stdout: { contains: 'milk' } }, milestone: 2 },
    ],
  }

  it('parses the mixed-driver reference scenario', () => {
  })

  it('parses a flow-bound, multi-section scenario', () => {
    const parsed = GuardScenarioSchema.parse(CLI_SCENARIO)
    expect(parsed.binds).toHaveLength(2)
    expect(parsed.flow).toEqual({ id: 'todo-lifecycle', fingerprint: 'sha256:flow' })
    expect(parsed.interface?.path).toEqual(['cli/todos-add', 'cli/todos-list'])
  })

  it('rejects a v1 scenario (clean cut — no union)', () => {
    const v1 = {
      ...CLI_SCENARIO,
      guard: 1,
      binds: { doc: 'docs/cli.md', section: 'todos/add', fingerprint: 'sha256:add' },
    }
    expect(() => GuardScenarioSchema.parse(v1)).toThrow()
  })

  it('needs at least one bind', () => {
    expect(() => GuardScenarioSchema.parse({ ...CLI_SCENARIO, binds: [] })).toThrow()
  })

  it('a hand-written scenario may omit flow + interface (the Manual pseudo-flow)', () => {
    const { flow: _f, interface: _j, ...handWritten } = CLI_SCENARIO
    const parsed = GuardScenarioSchema.parse(handWritten)
    expect(parsed.flow).toBeUndefined()
    expect(parsed.interface).toBeUndefined()
  })

  it('an interface ref carries a non-empty path and fingerprints', () => {
    expect(() =>
      GuardScenarioSchema.parse({ ...CLI_SCENARIO, interface: { path: [], fingerprints: [] } }),
    ).toThrow()
  })

  it('a cli step carries an optional per-step env overlay; absent parses exactly as today', () => {
    // Absent = today's shape: the field never materializes on the parsed step.
    const plain = GuardScenarioSchema.parse(CLI_SCENARIO)
    expect(plain.steps.every((s) => !('env' in s))).toBe(true)

    // Present: the same command observed under two environments in ONE scenario.
    const withEnv = GuardScenarioSchema.parse({
      ...CLI_SCENARIO,
      steps: [
        { run: ['telemetry', 'status'], expect: { exit: 0, stdout: { contains: 'enabled' } }, milestone: 1 },
        {
          run: ['telemetry', 'status'],
          env: { TRUECOURSE_TELEMETRY: '0' },
          expect: { exit: 0, stdout: { contains: 'disabled' } },
          milestone: 2,
        },
      ],
    })
    const envOf = (i: number) => (withEnv.steps[i] as { env?: Record<string, string> }).env
    expect(envOf(0)).toBeUndefined()
    expect(envOf(1)).toEqual({ TRUECOURSE_TELEMETRY: '0' })

    // Values are strings.
    expect(() => GuardStepSchema.parse({ run: [], env: { X: 1 }, expect: { exit: 0 } })).toThrow()
  })

  it('an api step has no per-step env (a booted server’s env is fixed at boot)', () => {
    expect(() =>
      GuardApiStepSchema.parse({
        request: { method: 'GET', path: '/x' },
        env: { X: '1' },
        expect: { status: 200 },
      }),
    ).toThrow()
  })

  it('steps carry an optional positive-integer milestone (both drivers)', () => {
    expect(GuardStepSchema.parse({ run: [], expect: { exit: 0 } }).milestone).toBeUndefined()
    expect(GuardStepSchema.parse({ run: [], expect: { exit: 0 }, milestone: 3 }).milestone).toBe(3)
    expect(() => GuardStepSchema.parse({ run: [], expect: { exit: 0 }, milestone: 0 })).toThrow()
    expect(
      GuardApiStepSchema.parse({ request: { method: 'GET', path: '/x' }, expect: { status: 200 }, milestone: 2 })
        .milestone,
    ).toBe(2)
  })
})
