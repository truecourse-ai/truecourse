import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runGuard, guardInterfacesPath } from '@truecourse/guard-runner'
import { interfaceFingerprint, type Interface, type InterfacesFile } from '@truecourse/shared'
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

const SPEC_DOC = specBinds('a/b')[0].doc

const TODOS: Interface = (() => {
  const shape = {
    type: 'api' as const,
    entry: { command: ['todos'] },
    steps: [{ kind: 'request' as const, method: 'POST', path: '/todos' }],
  }
  return { id: 'api/create-todo', title: 'create a todo', ...shape, fingerprint: interfaceFingerprint(shape) }
})()

function writeCatalog(root: string, interfaces: Interface[]): void {
  const file: InterfacesFile = {
    version: 2,
    generatedAt: new Date().toISOString(),
    recipeFingerprint: 'sha256:recipe',
    interfaces,
  }
  fs.mkdirSync(path.dirname(guardInterfacesPath(root)), { recursive: true })
  fs.writeFileSync(guardInterfacesPath(root), JSON.stringify(file, null, 2))
}

describe('runGuard — api driver flow annotations', () => {
  it('carries flowId, the failing milestone, and the drift annotation, and folds plural binds', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeCatalog(r, [TODOS])

    // Fails at its SECOND milestone (the fixture has no /todos/999).
    writeScenario(
      r,
      'api/fail.yaml',
      apiScenario({
        id: 'todo-lifecycle.api.1',
        flow: { id: 'todo-lifecycle', fingerprint: 'sha256:flow' },
        interface: { path: ['api/create-todo'], fingerprints: [TODOS.fingerprint] },
        binds: specBinds('cli/version', 'cli/whoami'),
        steps: [
          {
            request: { method: 'POST', path: '/todos', json: { title: 'buy milk' } },
            expect: { status: 201 },
            milestone: 1,
          },
          { request: { method: 'GET', path: '/todos/999' }, expect: { status: 200 }, milestone: 2 },
        ],
      }),
    )
    // Passes, but was grounded on a surface that has since moved.
    writeScenario(
      r,
      'api/drifted.yaml',
      apiScenario({
        id: 'todo-lifecycle.api.2',
        flow: { id: 'todo-lifecycle', fingerprint: 'sha256:flow' },
        interface: { path: ['api/create-todo'], fingerprints: ['sha256:older-surface'] },
        binds: specBinds('a/b'),
        steps: [{ request: { method: 'GET', path: '/todos' }, expect: { status: 200 }, milestone: 1 }],
      }),
    )
    // One bind stale ⇒ the whole scenario is stale and never boots a server.
    writeScenario(
      r,
      'api/stale.yaml',
      apiScenario({
        id: 'todo-lifecycle.api.3',
        flow: { id: 'todo-lifecycle', fingerprint: 'sha256:flow' },
        binds: [specBinds('a/b')[0], { doc: SPEC_DOC, section: 'cli/version', fingerprint: 'sha256:older-text' }],
        steps: [{ request: { method: 'GET', path: '/todos' }, expect: { status: 200 }, milestone: 1 }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error('expected ok')
    const by = new Map(res.latest.scenarios.map((s) => [s.id, s]))

    const failed = by.get('todo-lifecycle.api.1')!
    expect(failed.outcome).toBe('fail')
    expect(failed.flowId).toBe('todo-lifecycle')
    expect(failed.failedMilestone).toBe(2)
    expect(failed.interfaceDrifted).toBeUndefined()
    // Evidence names the flow and both bound sections.
    const transcript = fs.readFileSync(path.join(r, failed.evidencePath!, 'transcript.txt'), 'utf-8')
    expect(transcript).toContain('flow:     todo-lifecycle')
    expect(transcript).toContain('cli/whoami')

    expect(by.get('todo-lifecycle.api.2')).toMatchObject({
      outcome: 'pass',
      flowId: 'todo-lifecycle',
      interfaceDrifted: true,
    })

    const stale = by.get('todo-lifecycle.api.3')!
    expect(stale.outcome).toBe('stale')
    expect(stale.flowId).toBe('todo-lifecycle')
    expect(stale.currentFingerprint).toBe(specBinds('cli/version')[0].fingerprint)
    expect(stale.durationMs).toBe(0)

    // Both of the failing scenario's bound sections carry its red status.
    const red = res.latest.sections.filter((s) => s.scenarioIds.includes('todo-lifecycle.api.1'))
    expect(red.map((s) => s.section).sort()).toEqual(['cli/version', 'cli/whoami'])
    expect(red.every((s) => s.status === 'fail')).toBe(true)
  })
})
