import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runGuard, buildDocSectionIndex } from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeApiRecipe, apiScenario, writeScenario } from './helpers.js'

/** The honest OpenAPI description of the fixture todos server. */
const FIXTURE_OPENAPI = fileURLToPath(new URL('../fixtures/guard-fixture-api/openapi.yaml', import.meta.url))
const OPENAPI = fs.readFileSync(FIXTURE_OPENAPI, 'utf-8')

const DOC = 'api/openapi.yaml'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

/** Live binding for an operation section of the fixture OpenAPI doc. */
function opBinds(anchor: string): { doc: string; section: string; fingerprint: string } {
  const s = buildDocSectionIndex(DOC, OPENAPI).byAnchor.get(anchor)
  if (!s) throw new Error(`no operation ${anchor} in ${DOC}`)
  return { doc: DOC, section: anchor, fingerprint: s.fingerprint }
}

describe('runGuard — scenarios bound to OpenAPI operation sections', () => {
  it('binds and passes an api scenario against an OpenAPI-anchored operation', async () => {
    const r = repo()
    writeApiRecipe(r)
    fs.mkdirSync(path.join(r, 'api'), { recursive: true })
    fs.writeFileSync(path.join(r, DOC), OPENAPI)
    writeScenario(
      r,
      'api/list-todos.yaml',
      apiScenario({
        id: 'list-todos',
        binds: opBinds('paths/get-listtodos'),
        steps: [{ request: { method: 'GET', path: '/todos' }, expect: { status: 200, json: { todos: { equals: [] } } } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.summary).toMatchObject({ total: 1, pass: 1, fail: 0, error: 0, stale: 0, orphaned: 0 })
    expect(res.latest.scenarios[0].outcome).toBe('pass')
  }, 60_000)

  it('goes stale when the bound operation is edited in the yaml', async () => {
    const r = repo()
    writeApiRecipe(r)
    fs.mkdirSync(path.join(r, 'api'), { recursive: true })
    // Bind against the ORIGINAL fingerprint, then edit the getTodo operation so its
    // canonical slice (and fingerprint) changes — its scenario must go stale.
    const binds = opBinds('paths/get-gettodo')
    fs.writeFileSync(path.join(r, DOC), OPENAPI)
    writeScenario(
      r,
      'api/get-todo.yaml',
      apiScenario({
        id: 'get-todo',
        binds,
        steps: [{ request: { method: 'GET', path: '/todos/999' }, expect: { status: 404 } }],
      }),
    )
    // Edit only the getTodo operation summary — a real content change.
    fs.writeFileSync(path.join(r, DOC), OPENAPI.replace('summary: Fetch one todo', 'summary: Fetch a single todo by id'))

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.summary.stale).toBe(1)
    expect(res.latest.scenarios[0].outcome).toBe('stale')
  }, 60_000)

  it('orphans a scenario when its operation is deleted from the yaml', async () => {
    const r = repo()
    writeApiRecipe(r)
    fs.mkdirSync(path.join(r, 'api'), { recursive: true })
    const binds = opBinds('paths/delete-deletetodo')
    // Write a yaml with the delete operation removed entirely.
    const withoutDelete = OPENAPI.replace(/    delete:[\s\S]*?description: No todo has that id\.\n/, '')
    fs.writeFileSync(path.join(r, DOC), withoutDelete)
    writeScenario(
      r,
      'api/delete-todo.yaml',
      apiScenario({
        id: 'delete-todo',
        binds,
        steps: [{ request: { method: 'GET', path: '/health' }, expect: { status: 200 } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.summary.orphaned).toBe(1)
    expect(res.latest.scenarios[0].outcome).toBe('orphaned')
  }, 60_000)
})
