import { describe, it, expect } from 'vitest'
import {
  GuardScenarioSchema,
  GuardApiStepSchema,
  runnableDriverIds,
  awaitingDriverIds,
  isRunnableDriver,
} from '@truecourse/shared'

const BINDS = { doc: 'docs/api.md', section: 'todos/create', fingerprint: 'sha256:abc' }

const API_SCENARIO = {
  guard: 1,
  id: 'create.1',
  title: 'POST /todos creates a todo',
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
  it('the api driver is runnable in the registry', () => {
    expect(runnableDriverIds).toEqual(['cli', 'api'])
    expect(awaitingDriverIds).toEqual(['web', 'tui', 'library'])
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
})
