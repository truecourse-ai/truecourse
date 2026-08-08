/**
 * `describeGuardScenarioSteps` / `describeGuardScenarioSetup` — a committed test as
 * the STEP LIST the dashboard renders instead of raw YAML, and the STARTING WORLD
 * those steps run in. The words are the product's, so they live in shared (one
 * source for the server that ships them and the UI that shows them), and a file
 * that doesn't parse yields NOTHING rather than a half-rendered guess.
 */

import { describe, it, expect } from 'vitest'
import { describeGuardScenarioSetup, describeGuardScenarioSteps } from '@truecourse/shared'

const BINDS = [{ doc: 'docs/tasks.md', section: 'tasks/creating', fingerprint: 'sha256:abc' }]

const CLI_SCENARIO = {
  guard: 3,
  id: 'task-lifecycle.cli.1',
  title: 'Tasks are created and listed',
  binds: BINDS,
  driver: 'cli',
  steps: [
    { run: ['add', 'write the spec'], expect: { exit: 0 }, milestone: 1 },
    {
      run: ['list'],
      env: { NO_COLOR: '1' },
      repeat: 2,
      expect: { exit: 0, stdout: { contains: 'write the spec' }, files: { 'out.json': { exists: true } } },
      milestone: 2,
    },
    { run: [], expect: { stderr: { matches: 'usage: .*' } } },
  ],
}

const API_SCENARIO = {
  guard: 3,
  id: 'todo-lifecycle.api.1',
  title: 'POST /todos creates a todo',
  binds: BINDS,
  driver: 'api',
  steps: [
    {
      request: { method: 'POST', path: '/todos', json: { title: 'x' } },
      expect: { status: 201, json: { title: { equals: 'x' } }, schema: true },
      milestone: 1,
    },
  ],
}

describe('describeGuardScenarioSteps', () => {
  it('reads a cli test as numbered commands, their world, and what they assert', () => {
    const steps = describeGuardScenarioSteps(CLI_SCENARIO)
    expect(steps).toHaveLength(3)

    expect(steps[0]).toEqual({
      n: 1,
      kind: 'cli',
      command: 'add write the spec',
      expectation: 'exit 0',
      milestone: 1,
    })

    // The env overlay is the step's WORLD — it reads beside the command, never
    // hidden in the file.
    expect(steps[1].env).toEqual(['NO_COLOR=1'])
    expect(steps[1].repeat).toBe(2)
    expect(steps[1].expectation).toBe('exit 0 · stdout contains “write the spec” · out.json exists')

    // A bare entry invocation is still a step, with its own expectation.
    expect(steps[2].command).toBe('')
    expect(steps[2].expectation).toBe('stderr matches /usage: .*/')
    expect(steps[2].milestone).toBeUndefined()
  })

  it('reads an api test as METHOD + path, with the response it asserts', () => {
    const steps = describeGuardScenarioSteps(API_SCENARIO)
    expect(steps).toEqual([
      {
        n: 1,
        kind: 'api',
        command: 'POST /todos',
        expectation: 'status 201 · title is "x" · matches the declared response schema',
        milestone: 1,
      },
    ])
  })

  /**
   * WHAT a step drives is a fact about the step, not about the driver it happens to
   * sit under: a cli test runs the program, runs git, and mutates files, and a
   * reader scanning the list needs to tell those three apart before reading a
   * single command.
   */
  it('says what each step DRIVES — the program, git, or the sandbox files', () => {
    const steps = describeGuardScenarioSteps({
      ...CLI_SCENARIO,
      steps: [
        { run: ['add', 'x'], expect: { exit: 0 } },
        { git: ['init'], expect: { exit: 0 } },
        { write: { 'notes.md': '# hi\n' }, expect: { files: { 'notes.md': { exists: true } } } },
        { delete: ['notes.md'], expect: { files: { 'notes.md': { absent: true } } } },
      ],
    })
    expect(steps.map((s) => s.kind)).toEqual(['cli', 'git', 'file', 'file'])
  })

  it('reads every step of the api driver as api — its lifecycle actions included', () => {
    const steps = describeGuardScenarioSteps({
      ...API_SCENARIO,
      steps: [
        { boot: {} },
        { request: { method: 'GET', path: '/todos' }, expect: { status: 200 } },
        { signal: { name: 'SIGTERM' } },
      ],
    })
    expect(steps.map((s) => s.kind)).toEqual(['api', 'api', 'api'])
  })

  it('yields nothing for anything it cannot parse — never a half-rendered guess', () => {
    expect(describeGuardScenarioSteps({ guard: 3, driver: 'telepathy', steps: [] })).toEqual([])
    expect(describeGuardScenarioSteps('not a scenario')).toEqual([])
    expect(describeGuardScenarioSteps(null)).toEqual([])
  })
})

describe('describeGuardScenarioSetup', () => {
  const withSetup = (setup: unknown) => describeGuardScenarioSetup({ ...CLI_SCENARIO, setup })

  it('reads the seeded files in declaration order, path and content apart', () => {
    // The path is what the reader scans; the content is what they open.
    expect(withSetup({ files: { 'tasks.json': '[]\n', 'README.md': '# demo\n' } })).toEqual({
      files: [
        { path: 'tasks.json', content: '[]\n' },
        { path: 'README.md', content: '# demo\n' },
      ],
    })
  })

  it('reads the git world as one line per declared fact', () => {
    expect(
      withSetup({
        git: {
          root: 'repo',
          branch: 'trunk',
          identity: { name: 'Guard Runner', email: 'guard@example.com' },
          commits: [
            { files: ['a.txt', 'b.txt'], message: 'seed the store' },
            { files: ['c.txt'] },
          ],
          staged: ['d.txt'],
        },
      }),
    ).toEqual({
      git: [
        'initializes a git repository in repo',
        'on branch trunk',
        'commits as Guard Runner <guard@example.com>',
        'commit 1 \u201cseed the store\u201d \u2014 a.txt, b.txt',
        'commit 2 \u2014 c.txt',
        'staged, uncommitted \u2014 d.txt',
      ],
    })
  })

  it('an EMPTY git block still says the one thing it means: there is a repository', () => {
    expect(withSetup({ git: {} })).toEqual({ git: ['initializes a git repository'] })
  })

  it('reads the env overlay as K=V — the shape a step\u2019s own overlay uses', () => {
    expect(withSetup({ env: { NO_COLOR: '1', TASKS_HOME: '.tmp' } })).toEqual({
      env: ['NO_COLOR=1', 'TASKS_HOME=.tmp'],
    })
  })

  it('is undefined when the file declares no setup, and when it parses as nothing', () => {
    expect(describeGuardScenarioSetup(CLI_SCENARIO)).toBeUndefined()
    expect(describeGuardScenarioSetup('not a scenario')).toBeUndefined()
    expect(describeGuardScenarioSetup(null)).toBeUndefined()
  })

  it('carries only the world-state kinds — the scripted third parties are not it', () => {
    // `http` stubs say what the test TALKS TO, not the state it begins from, so a
    // setup declaring nothing else is nothing to render.
    expect(
      withSetup({ http: { billing: { routes: [{ method: 'GET', path: '/v1/ping', status: 200 }] } } }),
    ).toBeUndefined()
  })
})
