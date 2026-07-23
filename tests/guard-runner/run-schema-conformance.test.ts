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

/** Live binding for an operation section of a given OpenAPI doc content. */
function opBinds(content: string, anchor: string): { doc: string; section: string; fingerprint: string } {
  const s = buildDocSectionIndex(DOC, content).byAnchor.get(anchor)
  if (!s) throw new Error(`no operation ${anchor}`)
  return { doc: DOC, section: anchor, fingerprint: s.fingerprint }
}

function seedDoc(r: string, content: string): void {
  fs.mkdirSync(path.join(r, 'api'), { recursive: true })
  fs.writeFileSync(path.join(r, DOC), content)
}

describe('runGuard — expect.schema response-conformance (B5)', () => {
  it('passes schema:true when the response conforms to the declared operation schema', async () => {
    const r = repo()
    writeApiRecipe(r)
    seedDoc(r, OPENAPI)
    writeScenario(
      r,
      'api/list.yaml',
      apiScenario({
        id: 'list-conforms',
        binds: opBinds(OPENAPI, 'paths/get-listtodos'),
        steps: [{ request: { method: 'GET', path: '/todos' }, expect: { status: 200, schema: true } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.scenarios[0].outcome).toBe('pass')
  }, 60_000)

  it('fails schema:true and names the dropped field path when the response omits a required field', async () => {
    const r = repo()
    // Doctor the doc so the Todo response schema REQUIRES a field the fixture server
    // never returns (`archived`) — a documented-vs-actual drift the schema check catches.
    const drifted = OPENAPI.replace(
      '    Todo:\n      type: object\n      properties:',
      '    Todo:\n      type: object\n      required:\n        - archived\n      properties:',
    )
    expect(drifted).not.toBe(OPENAPI)
    writeApiRecipe(r)
    seedDoc(r, drifted)
    writeScenario(
      r,
      'api/get.yaml',
      apiScenario({
        id: 'get-drift',
        binds: opBinds(drifted, 'paths/get-gettodo'),
        steps: [
          { request: { method: 'POST', path: '/todos', json: { title: 'x' } }, expect: { status: 201 } },
          { request: { method: 'GET', path: '/todos/1' }, expect: { status: 200, schema: true } },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const s = res.latest.scenarios[0]
    expect(s.outcome).toBe('fail')
    expect(s.failure!.step).toBe(2)
    expect(s.failure!.expected).toContain('archived')
    // The field path rides the written evidence (diff/transcript).
    const dir = path.join(r, s.evidencePath!)
    expect(fs.readFileSync(path.join(dir, 'diff.txt'), 'utf-8')).toContain('archived')
  }, 60_000)

  it('errors (never silently passes) when schema:true binds to a non-OpenAPI section', async () => {
    const r = repo()
    // Bind to the shared MARKDOWN spec doc — no OpenAPI operation, so schema is unresolvable.
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/nonop.yaml',
      apiScenario({
        id: 'schema-unresolvable',
        steps: [{ request: { method: 'GET', path: '/health' }, expect: { status: 200, schema: true } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const s = res.latest.scenarios[0]
    expect(s.outcome).toBe('error')
    expect(s.failure!.actual).toMatch(/OpenAPI operation/i)
  }, 60_000)

  it('errors when the bound operation declares no JSON schema for the asserted status', async () => {
    const r = repo()
    writeApiRecipe(r)
    seedDoc(r, OPENAPI)
    // deleteTodo's 204 declares no response body schema.
    writeScenario(
      r,
      'api/del.yaml',
      apiScenario({
        id: 'no-schema-status',
        binds: opBinds(OPENAPI, 'paths/delete-deletetodo'),
        steps: [
          { request: { method: 'POST', path: '/todos', json: { title: 'x' } }, expect: { status: 201 } },
          { request: { method: 'DELETE', path: '/todos/1' }, expect: { status: 204, schema: true } },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const s = res.latest.scenarios[0]
    expect(s.outcome).toBe('error')
    expect(s.failure!.actual).toMatch(/no JSON response schema for status 204/)
  }, 60_000)

  it('errors when a schema:true step requests a different endpoint than the bound operation', async () => {
    const r = repo()
    writeApiRecipe(r)
    seedDoc(r, OPENAPI)
    // Bound to GET /todos, but the schema:true step hits GET /health (a different op).
    writeScenario(
      r,
      'api/multiop.yaml',
      apiScenario({
        id: 'multiop-mismatch',
        binds: opBinds(OPENAPI, 'paths/get-listtodos'),
        steps: [{ request: { method: 'GET', path: '/health' }, expect: { status: 200, schema: true } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const s = res.latest.scenarios[0]
    expect(s.outcome).toBe('error')
    expect(s.failure!.actual).toMatch(/bound operation GET \/todos/)
  }, 60_000)

  // The doc's operation paths are bare (`/todos`); a `servers` base path is what the
  // bound op must be reunited with so it matches the base-pathed request URLs. The
  // fixture server strips TC_BASE_PATH before routing, standing in for a mounted app.
  const BASE_PATHED = `servers:\n  - url: /api/v1\n${OPENAPI}`

  it('resolves and validates schema:true against a base-pathed OpenAPI server (item 43)', async () => {
    const r = repo()
    writeApiRecipe(r)
    seedDoc(r, BASE_PATHED)
    writeScenario(
      r,
      'api/base-list.yaml',
      apiScenario({
        id: 'base-conforms',
        binds: opBinds(BASE_PATHED, 'paths/get-listtodos'),
        setup: { env: { TC_BASE_PATH: '/api/v1' } },
        steps: [{ request: { method: 'GET', path: '/api/v1/todos' }, expect: { status: 200, schema: true } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.scenarios[0].outcome).toBe('pass')
  }, 60_000)

  it('still errors on a genuinely different endpoint under a base-pathed spec, naming the base-pathed bound op', async () => {
    const r = repo()
    writeApiRecipe(r)
    seedDoc(r, BASE_PATHED)
    // Bound to GET /api/v1/todos, but the schema:true step hits /api/v1/other.
    writeScenario(
      r,
      'api/base-mismatch.yaml',
      apiScenario({
        id: 'base-mismatch',
        binds: opBinds(BASE_PATHED, 'paths/get-listtodos'),
        setup: { env: { TC_BASE_PATH: '/api/v1' } },
        steps: [{ request: { method: 'GET', path: '/api/v1/other' }, expect: { status: 200, schema: true } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const s = res.latest.scenarios[0]
    expect(s.outcome).toBe('error')
    expect(s.failure!.actual).toMatch(/bound operation GET \/api\/v1\/todos/)
    expect(s.failure!.actual).toContain('GET /api/v1/other')
  }, 60_000)

  it('validates schema:true at birth (injected scenarios, persist:false)', async () => {
    const r = repo()
    const drifted = OPENAPI.replace(
      '    Todo:\n      type: object\n      properties:',
      '    Todo:\n      type: object\n      required:\n        - archived\n      properties:',
    )
    writeApiRecipe(r)
    seedDoc(r, drifted)
    const scenario = apiScenario({
      id: 'birth-drift',
      binds: opBinds(drifted, 'paths/get-gettodo'),
      steps: [
        { request: { method: 'POST', path: '/todos', json: { title: 'x' } }, expect: { status: 201 } },
        { request: { method: 'GET', path: '/todos/1' }, expect: { status: 200, schema: true } },
      ],
    })

    const res = await runGuard({ repoRoot: r, skipBuild: true, scenarios: [scenario], persist: false })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.scenarios[0].outcome).toBe('fail')
    expect(res.latest.scenarios[0].failure!.expected).toContain('archived')
  }, 60_000)
})
