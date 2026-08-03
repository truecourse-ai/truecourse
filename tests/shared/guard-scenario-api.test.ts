import { describe, it, expect } from 'vitest'
import {
  GuardScenarioSchema,
  GuardApiStepSchema,
  GuardStepSchema,
  GUARD_FORMAT_VERSION,
  runnableDriverIds,
  awaitingDriverIds,
  isRunnableDriver,
} from '@truecourse/shared'

const BINDS = [{ doc: 'docs/api.md', section: 'todos/create', fingerprint: 'sha256:abc' }]

const API_SCENARIO = {
  guard: 2,
  id: 'todo-lifecycle.api.1',
  title: 'POST /todos creates a todo',
  flow: { id: 'todo-lifecycle', fingerprint: 'sha256:flow' },
  journey: { path: ['api/create-todo'], fingerprints: ['sha256:journey'] },
  binds: BINDS,
  driver: 'api',
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
  it('carries an optional `server` the cli driver has no counterpart for', () => {
    expect(GuardScenarioSchema.safeParse({ ...API_SCENARIO, server: 'api-v2' }).success).toBe(true)
    // Absent is the pre-multi-server meaning: the recipe's default server.
    const bare = GuardScenarioSchema.safeParse(API_SCENARIO)
    expect(bare.success).toBe(true)
    if (bare.success) expect((bare.data as { server?: string }).server).toBeUndefined()
    // A cli scenario runs a binary, not a server — the field is refused there.
    const cli = {
      guard: GUARD_FORMAT_VERSION,
      id: 'x.cli.1',
      title: 'x',
      binds: BINDS,
      driver: 'cli',
      steps: [{ run: ['--version'], expect: { exitCode: 0 } }],
      server: 'api-v2',
    }
    expect(GuardScenarioSchema.safeParse(cli).success).toBe(false)
  })

  it('the api driver is runnable in the registry', () => {
    expect(runnableDriverIds).toEqual(['cli', 'api'])
    // desktop + mobile are recorded journey types, appended last (the enum order
    // is fingerprinted into the extraction prompt).
    expect(awaitingDriverIds).toEqual(['web', 'tui', 'library', 'desktop', 'mobile'])
    expect(isRunnableDriver('api')).toBe(true)
  })

  it('parses a full api scenario (envelope + api verbs)', () => {
    const parsed = GuardScenarioSchema.parse(API_SCENARIO)
    expect(parsed.driver).toBe('api')
    expect(parsed.normalize).toEqual([])
  })

  it('rejects api verbs under the cli driver and vice versa', () => {
    expect(() => GuardScenarioSchema.parse({ ...API_SCENARIO, driver: 'cli' })).toThrow()
    const cliSteps = [{ run: ['--version'], expect: { exit: 0 } }]
    expect(() => GuardScenarioSchema.parse({ ...API_SCENARIO, steps: cliSteps })).toThrow()
  })

  it('a step may capture from response HEADERS (additive, no format bump)', () => {
    const step = {
      request: { method: 'GET', path: '/redirect' },
      captureHeaders: { next: 'Location', tok: 'x-auth-token' },
      expect: { status: 302 },
    }
    expect(GuardApiStepSchema.parse(step).captureHeaders).toEqual({ next: 'Location', tok: 'x-auth-token' })
    // Values are header NAMES (strings), and the format version does not move.
    expect(() =>
      GuardApiStepSchema.parse({ ...step, captureHeaders: { next: 1 } }),
    ).toThrow()
    expect(GUARD_FORMAT_VERSION).toBe(2)
    // A scenario predating the field parses unchanged.
    expect(() => GuardScenarioSchema.parse(API_SCENARIO)).not.toThrow()
  })

  it('rejects an unknown driver', () => {
    expect(() => GuardScenarioSchema.parse({ ...API_SCENARIO, driver: 'web' })).toThrow()
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
    expect(parsed.driver).toBe('api')
    expect((parsed.steps[0].expect as { schema?: boolean }).schema).toBeUndefined()
  })

  it('still rejects an unknown expect key (strict envelope preserved)', () => {
    const step = { request: { method: 'GET', path: '/x' }, expect: { status: 200, bogus: true } }
    expect(() => GuardApiStepSchema.parse(step)).toThrow()
  })
})

describe('guard scenario envelope v2', () => {
  const CLI_SCENARIO = {
    guard: 2,
    id: 'todo-lifecycle.cli.1',
    title: 'todos are added and listed',
    flow: { id: 'todo-lifecycle', fingerprint: 'sha256:flow' },
    journey: { path: ['cli/todos-add', 'cli/todos-list'], fingerprints: ['sha256:a', 'sha256:b'] },
    binds: [
      { doc: 'docs/cli.md', section: 'todos/add', fingerprint: 'sha256:add' },
      { doc: 'docs/cli.md', section: 'todos/list', fingerprint: 'sha256:list' },
    ],
    driver: 'cli',
    steps: [
      { run: ['todos', 'add', 'milk'], expect: { exit: 0 }, milestone: 1 },
      { run: ['todos', 'list'], expect: { exit: 0, stdout: { contains: 'milk' } }, milestone: 2 },
    ],
  }

  it('the format version is 2', () => {
    expect(GUARD_FORMAT_VERSION).toBe(2)
  })

  it('parses a flow-bound, multi-section scenario', () => {
    const parsed = GuardScenarioSchema.parse(CLI_SCENARIO)
    expect(parsed.binds).toHaveLength(2)
    expect(parsed.flow).toEqual({ id: 'todo-lifecycle', fingerprint: 'sha256:flow' })
    expect(parsed.journey?.path).toEqual(['cli/todos-add', 'cli/todos-list'])
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

  it('a hand-written scenario may omit flow + journey (the Manual pseudo-flow)', () => {
    const { flow: _f, journey: _j, ...handWritten } = CLI_SCENARIO
    const parsed = GuardScenarioSchema.parse(handWritten)
    expect(parsed.flow).toBeUndefined()
    expect(parsed.journey).toBeUndefined()
  })

  it('a journey ref carries a non-empty path and fingerprints', () => {
    expect(() =>
      GuardScenarioSchema.parse({ ...CLI_SCENARIO, journey: { path: [], fingerprints: [] } }),
    ).toThrow()
  })

  it('a cli step carries an optional per-step env overlay; absent parses exactly as today', () => {
    // Absent = today's shape: the field never materializes on the parsed step.
    const plain = GuardScenarioSchema.parse(CLI_SCENARIO)
    expect(plain.driver === 'cli' && plain.steps.every((s) => s.env === undefined)).toBe(true)

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
    if (withEnv.driver !== 'cli') throw new Error('expected the cli driver')
    expect(withEnv.steps[0].env).toBeUndefined()
    expect(withEnv.steps[1].env).toEqual({ TRUECOURSE_TELEMETRY: '0' })

    // Values are strings, and the format version does NOT move for an optional field.
    expect(() => GuardStepSchema.parse({ run: [], env: { X: 1 }, expect: { exit: 0 } })).toThrow()
    expect(GUARD_FORMAT_VERSION).toBe(2)
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
