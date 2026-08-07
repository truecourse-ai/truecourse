/**
 * `describeGuardScenario` — the ONE plain-words rendering the dashboard's Story
 * mode and `guard flows --show <id> --story` both read. The suite pins the
 * VOCABULARY of both drivers: cli argv/stdin/env/file assertions, and the api
 * journey's requests, bodies, captures (`capture` + `captureHeaders`), `${var}`
 * chaining, the server-process lifecycle (boot / signal / logs) and the seeded,
 * stubbed, fault-scripted world a `setup` block declares.
 */
import { describe, it, expect } from 'vitest'
import { describeGuardScenario, GUARD_FORMAT_VERSION } from '@truecourse/shared'

const binds = [{ doc: 'docs/api.md', section: 'todos', fingerprint: 'sha256:abc' }]

const cliScenario = (over: Record<string, unknown> = {}) => ({
  guard: GUARD_FORMAT_VERSION,
  id: 'task-lifecycle.cli.1',
  title: 'Adding a task lists it',
  promise: 'A user adds a task and sees it in the list',
  binds,
  driver: 'cli',
  normalize: [],
  steps: [{ run: ['add', 'buy milk'], expect: { exit: 0, stdout: { contains: 'added' } }, milestone: 1 }],
  ...over,
})

const apiScenario = (over: Record<string, unknown> = {}) => ({
  guard: GUARD_FORMAT_VERSION,
  id: 'todo-crud.api.1',
  title: 'Creating a todo returns it',
  promise: 'A user creates a todo and reads it back',
  binds,
  driver: 'api',
  normalize: [],
  steps: [{ request: { method: 'POST', path: '/todos' }, expect: { status: 201 } }],
  ...over,
})

describe('describeGuardScenario — the envelope', () => {
  it('leads with the flow promise the artifact carries, and keeps the title beside it', () => {
    const story = describeGuardScenario(cliScenario())!
    expect(story.promise).toBe('A user adds a task and sees it in the list')
    expect(story.title).toBe('Adding a task lists it')
    expect(story.driver).toBe('cli')
    expect(story.binds).toEqual([{ doc: 'docs/api.md', section: 'todos' }])
  })

  it('omits the promise on a scenario written without one (hand-written, or pre-field)', () => {
    const { promise: _dropped, ...rest } = cliScenario()
    expect(describeGuardScenario(rest)!.promise).toBeUndefined()
  })

  it('returns null for anything that is not a parseable scenario — never a half-story', () => {
    expect(describeGuardScenario({ guard: 3, driver: 'telepathy' })).toBeNull()
    expect(describeGuardScenario('not a scenario')).toBeNull()
  })

  it('names the recipe server a multi-server api scenario drives, and the normalizations', () => {
    const story = describeGuardScenario(apiScenario({ server: 'api-v2', normalize: ['timestamps'] }))!
    expect(story.server).toBe('api-v2')
    expect(story.normalizers).toEqual(['timestamps are masked before comparison'])
  })
})

describe('describeGuardScenario — the cli vocabulary', () => {
  it('renders the argv, the per-step env, stdin, and every expectation as a sentence', () => {
    const story = describeGuardScenario(
      cliScenario({
        steps: [
          {
            run: ['add', 'buy milk'],
            stdin: 'yes\n',
            env: { TZ: 'UTC' },
            repeat: 3,
            milestone: 2,
            expect: {
              exit: 0,
              stdout: { contains: 'added' },
              stderr: { equals: '' },
              files: { 'tasks.json': { exists: true }, 'tmp.lock': { absent: true } },
            },
          },
        ],
      }),
    )!
    const [step] = story.steps
    expect(step).toMatchObject({ n: 1, does: 'run the program with `add "buy milk"`', repeat: 3, milestone: 2 })
    expect(step.env).toEqual(['TZ=UTC'])
    expect(step.stdin).toBe('yes')
    expect(step.expectations).toEqual([
      'the exit code is 0',
      'stdout contains “added”',
      'stderr is exactly “”',
      'the file tasks.json exists',
      'the file tmp.lock is gone',
    ])
  })

  it('says so when a step runs the bare entrypoint', () => {
    const story = describeGuardScenario(cliScenario({ steps: [{ run: [], expect: { exit: 0 } }] }))!
    expect(story.steps[0].does).toBe('run the program with no arguments')
  })

  it('renders a `matches` matcher as the regex it is', () => {
    const story = describeGuardScenario(
      cliScenario({ steps: [{ run: ['ls'], expect: { stdout: { matches: 'added t[0-9]+' } } }] }),
    )!
    expect(story.steps[0].expectations).toEqual(['stdout matches /added t[0-9]+/'])
  })
})

describe('describeGuardScenario — the api journey vocabulary', () => {
  it('renders the request, its body, its captures and every expectation', () => {
    const story = describeGuardScenario(
      apiScenario({
        steps: [
          {
            request: { method: 'POST', path: '/todos', json: { title: 'buy milk' } },
            capture: { id: 'data.id' },
            captureHeaders: { token: 'x-auth-token' },
            milestone: 1,
            expect: {
              status: 201,
              headers: { location: { contains: '/todos/' } },
              body: { matches: 'buy' },
              json: { 'data.id': { exists: true }, '': { contains: 'title' } },
              schema: true,
            },
          },
        ],
      }),
    )!
    const [step] = story.steps
    expect(step.does).toBe('POST /todos, sending JSON {"title":"buy milk"}')
    expect(step.captures).toEqual([
      'remembers `id` from `data.id` in the response body',
      'remembers `token` from the response header `x-auth-token`',
    ])
    expect(step.expectations).toEqual([
      'the response status is 201',
      'the response header `location` contains “/todos/”',
      'the response body matches /buy/',
      '`data.id` in the response body is present',
      'the response body contains “title”',
      'the whole response body conforms to the schema the documented operation declares for that status',
    ])
  })

  it('names the earlier captures a step chains on, and never the engine`s own ${unique}', () => {
    const story = describeGuardScenario(
      apiScenario({
        steps: [
          { request: { method: 'POST', path: '/todos', json: { slug: 'a-${unique}' } }, capture: { id: 'id' }, expect: { status: 201 } },
          { request: { method: 'GET', path: '/todos/${id}' }, expect: { status: 200 } },
        ],
      }),
    )!
    expect(story.steps[0].uses).toBeUndefined()
    expect(story.steps[1].uses).toEqual(['id'])
  })

  it('renders the server-process lifecycle — boot, signal, and the log window', () => {
    const story = describeGuardScenario(
      apiScenario({
        steps: [
          { boot: { env: { PORT_MODE: 'strict' }, expect: { exitCode: 1, stderrContains: ['missing DATABASE_URL'] } } },
          { boot: {} },
          { request: { method: 'GET', path: '/todos' }, expect: { status: 200 } },
          { logs: { stream: 'stdout', match: { pattern: 'GET /todos 200' }, sinceLastStep: true, count: 1 } },
          { signal: { name: 'SIGTERM', expect: { exitCode: 0, withinMs: 5000 } } },
        ],
      }),
    )!
    expect(story.steps[0]).toMatchObject({ does: '(re)start the server under test', env: ['PORT_MODE=strict'] })
    expect(story.steps[0].expectations).toEqual([
      'the process exits with code 1',
      'its stderr contains “missing DATABASE_URL”',
    ])
    expect(story.steps[1]).toMatchObject({
      does: 'start the server under test',
      expectations: ['the server answers its health path and is ready to serve'],
    })
    expect(story.steps[3]).toMatchObject({ does: 'read what the server wrote to stdout' })
    expect(story.steps[3].expectations).toEqual([
      'exactly 1 stdout line matches /GET /todos 200/',
      'only output written since the previous step began counts',
    ])
    expect(story.steps[4]).toMatchObject({ does: 'send SIGTERM to the running server' })
    expect(story.steps[4].expectations).toEqual([
      'the process exits with code 0',
      'it goes down within 5000ms',
    ])
  })

  it('marks a step that asserts nothing as preparation, not as a silent gap', () => {
    const story = describeGuardScenario(
      apiScenario({ steps: [{ request: { method: 'GET', path: '/health' }, expect: {} }] }),
    )!
    expect(story.steps[0].expectations).toEqual([])
  })
})

describe('describeGuardScenario — the world a setup block declares', () => {
  it('renders seeded files, env, and a git history', () => {
    const story = describeGuardScenario(
      cliScenario({
        setup: {
          files: { 'notes.txt': 'hi', 'cfg.json': '{}' },
          env: { TZ: 'UTC' },
          git: { branch: 'main', commits: [{ files: ['notes.txt'] }], staged: ['cfg.json'] },
        },
      }),
    )!
    expect(story.world).toEqual([
      'The sandbox starts with 2 seeded files: notes.txt, cfg.json.',
      'The program runs with `TZ=UTC` in its environment.',
      'A git repository on branch `main` is created in the sandbox with 1 commit and 1 staged file.',
    ])
  })

  it('renders an http stub — its routes, its unmatched policy, and its call counts', () => {
    const story = describeGuardScenario(
      apiScenario({
        setup: {
          http: {
            weather: {
              routes: [
                { method: 'GET', path: '/v1/forecast', json: { t: 1 }, expect: { query: { lat: '52' } } },
                { method: 'POST', path: '/v1/track', calls: 0 },
              ],
            },
          },
        },
      }),
    )!
    expect(story.world).toEqual([
      'A fake `weather` service answers GET /v1/forecast, POST /v1/track — a call to anything else fails the test. 1 of them assert what the app sent; POST /v1/track must never be called.',
    ])
  })

  it('renders a provided external`s fault script and its call budget', () => {
    const story = describeGuardScenario(
      apiScenario({
        setup: {
          externals: {
            stripe: { faults: [{ refuse: true, once: true }, { match: { method: 'POST' }, delayMs: 200 }], calls: 2 },
          },
        },
      }),
    )!
    expect(story.world).toEqual([
      'The real `stripe` service is scripted: every call refuses the connection (once, then the next rule); POST call waits 200ms; and the app must call it exactly 2 times.',
    ])
  })
})
