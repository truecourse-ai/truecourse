/**
 * `describeGuardScenarioSteps` — a committed test as the STEP LIST the dashboard
 * renders instead of raw YAML. The words are the product's, so they live in
 * shared (one source for the server that ships them and the UI that shows them),
 * and a file that doesn't parse yields NOTHING rather than a half-rendered guess.
 */

import { describe, it, expect } from 'vitest'
import { describeGuardScenarioSteps } from '@truecourse/shared'

const BINDS = [{ doc: 'docs/tasks.md', section: 'tasks/creating', fingerprint: 'sha256:abc' }]

const CLI_SCENARIO = {
  guard: 2,
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
  guard: 2,
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

    expect(steps[0]).toEqual({ n: 1, command: 'add write the spec', expectation: 'exit 0', milestone: 1 })

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
        command: 'POST /todos',
        expectation: 'status 201 · title is "x" · matches the declared response schema',
        milestone: 1,
      },
    ])
  })

  it('yields nothing for anything it cannot parse — never a half-rendered guess', () => {
    expect(describeGuardScenarioSteps({ guard: 2, driver: 'telepathy', steps: [] })).toEqual([])
    expect(describeGuardScenarioSteps('not a scenario')).toEqual([])
    expect(describeGuardScenarioSteps(null)).toEqual([])
  })
})
