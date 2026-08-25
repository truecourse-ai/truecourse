import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runGuard } from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeApiRecipe, writeScenario, apiScenario, specBinds } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

describe('api capture — the `${captured:…}` spelling and the numeric comparison', () => {
  it('captures a response field and a header, then uses both by name in a later step', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/chain.yaml',
      apiScenario({
        id: 'api-chain',
        binds: specBinds('cli/version'),
        steps: [
          {
            request: { method: 'POST', path: '/todos', json: { title: 'buy milk' } },
            capture: { todoId: 'id' },
            captureHeaders: { service: 'x-service' },
            expect: { status: 201 },
          },
          {
            // The canonical token spelling, in a path AND in an expectation value.
            request: { method: 'PATCH', path: '/todos/${captured:todoId}', json: { title: 'buy oat milk' } },
            expect: {
              status: 200,
              json: { title: { equals: 'buy oat milk' }, id: { equals: '${captured:todoId}' } },
              headers: { 'x-service': { equals: '${captured:service}' } },
            },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const result = res.latest.scenarios.find((s) => s.id === 'api-chain')!
    expect(result.failure).toBeUndefined()
    expect(result.outcome).toBe('pass')

    const dir = path.join(r, result.evidencePath!)
    const invocation = JSON.parse(fs.readFileSync(path.join(dir, 'invocation.json'), 'utf-8'))
    expect(invocation.steps[0].captured).toEqual({ service: 'todos', todoId: '1' })
    expect(invocation.steps[1].path).toBe('/todos/1')
  })

  it('compares a json number against a captured one — at-least holds, at-most reports both', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/growing.yaml',
      apiScenario({
        id: 'api-growing',
        binds: specBinds('cli/version'),
        steps: [
          {
            request: { method: 'POST', path: '/todos', json: { title: 'first' } },
            capture: { firstId: 'id' },
            expect: { status: 201 },
          },
          {
            request: { method: 'POST', path: '/todos', json: { title: 'second' } },
            expect: { status: 201, json: { id: { compare: { atLeast: '${captured:firstId}' } } } },
          },
        ],
      }),
    )
    writeScenario(
      r,
      'api/over.yaml',
      apiScenario({
        id: 'api-over',
        binds: specBinds('cli/version'),
        steps: [
          {
            request: { method: 'POST', path: '/todos', json: { title: 'first' } },
            capture: { firstId: 'id' },
            expect: { status: 201 },
          },
          {
            request: { method: 'POST', path: '/todos', json: { title: 'second' } },
            expect: { status: 201, json: { id: { compare: { atMost: '${captured:firstId}' } } } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error('run did not settle')

    const growing = res.latest.scenarios.find((s) => s.id === 'api-growing')!
    expect(growing.failure).toBeUndefined()
    expect(growing.outcome).toBe('pass')

    const over = res.latest.scenarios.find((s) => s.id === 'api-over')!
    expect(over.outcome).toBe('fail')
    expect(over.failure!.step).toBe(2)
    // Resolved on both sides: the reader sees the two numbers, not the token.
    expect(over.failure!.expected).toContain('at most 1')
    expect(over.failure!.actual).toContain('2')
  })

  it('a capture whose field is missing fails ITS OWN step, never an empty value flowing on', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/miss.yaml',
      apiScenario({
        id: 'api-miss',
        binds: specBinds('cli/version'),
        steps: [
          {
            request: { method: 'POST', path: '/todos', json: { title: 'x' } },
            capture: { slug: 'slug' },
            expect: { status: 201 },
          },
          { request: { method: 'GET', path: '/todos/${captured:slug}' }, expect: { status: 200 } },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error('run did not settle')
    const result = res.latest.scenarios.find((s) => s.id === 'api-miss')!
    expect(result.outcome).toBe('fail')
    expect(result.failure!.step).toBe(1)
    expect(result.failure!.expected).toContain('capture "slug"')
  })
})
