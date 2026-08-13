import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { readManifest, buildDocSectionIndex } from '@truecourse/guard-runner'
import { GuardScenarioSchema, guardManifestSections, guardScenarioDrivers } from '@truecourse/shared'
import {
  makeTempRepo,
  rmrf,
  writeApiRecipe,
  writeCorpus,
  writeDoc,
  extractBy,
  authorBy,
  rawApi,
  runGenerate,
  interfacesOf,
  apiInterface,
} from './helpers.js'

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

const CREATE_STEPS = [
  {
    request: { method: 'POST', path: '/todos', json: { title: 'buy milk' } },
    expect: { status: 201, json: { title: { equals: 'buy milk' }, done: { equals: false } } },
  },
] as never
const LIST_STEPS = [
  { request: { method: 'GET', path: '/todos' }, expect: { status: 200, json: { todos: { equals: [] } } } },
] as never

/** The fixture's two write/read operations, as the interface mapper would derive them. */
const todoInterfaces = (r: string) => interfacesOf(r, apiInterface('GET', '/todos'), apiInterface('POST', '/todos'))

describe('generateGuards — OpenAPI doc as claim source (end to end)', () => {
  it('extracts api claims per operation, authors, and births them against the fixture server', async () => {
    const r = repo()
    writeApiRecipe(r, { entry: null })
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, OPENAPI)

    const res = await runGenerate({
      repoRoot: r,
      interfaces: todoInterfaces(r),
      extractRunner: extractBy({
        'paths/get-listtodos': [{ driver: 'api', claim: 'GET /todos returns 200 with the todo list', reason: 'HTTP status + body' }],
        'paths/post-createtodo': [{ driver: 'api', claim: 'POST /todos creates a todo and returns 201', reason: 'HTTP status + body' }],
        'paths/get-gethealth': { untestable: 'liveness probe, covered by ops' },
        'paths/get-gettodo': { untestable: 'covered by list' },
        'paths/patch-updatetodo': { untestable: 'covered by list' },
        'paths/delete-deletetodo': { untestable: 'covered by list' },
      }),
      // A flow is titled after the operation anchor, so its id is the anchor slug.
      generateRunner: authorBy({
        'paths-get-listtodos': rawApi('GET /todos answers 200 with the empty list', LIST_STEPS),
        'paths-post-createtodo': rawApi('POST /todos creates a todo (201)', CREATE_STEPS),
      }),
    })

    expect(res.status).toBe('ok')
    expect(res.errors).toEqual([])
    expect(res.birthFindings).toEqual([])
    expect(res.written.map((w) => w.anchor).sort()).toEqual(['paths/get-listtodos', 'paths/post-createtodo'])
    expect(res.written.every((w) => w.surface === 'api')).toBe(true)

    // Both committed scenarios are valid api-driver YAML bound to their operation.
    for (const w of res.written) {
      const committed = yaml.load(fs.readFileSync(path.join(r, w.file), 'utf-8')) as {
        binds: Array<{ doc: string; section: string; fingerprint: string }>
      }
      expect(guardScenarioDrivers(GuardScenarioSchema.parse(committed))).toEqual(['api'])
      expect(committed.binds[0].doc).toBe(DOC)
      expect(committed.binds[0].section.startsWith('paths/')).toBe(true)
    }

    // The manifest's section fingerprints are byte-identical to what a run
    // derives (generate == run).
    const manifest = guardManifestSections(readManifest(r))
    const index = buildDocSectionIndex(DOC, OPENAPI)
    for (const anchor of ['paths/get-listtodos', 'paths/post-createtodo']) {
      const sec = manifest.find((s) => s.anchor === anchor)!
      expect(sec.fingerprint).toBe(index.byAnchor.get(anchor)!.fingerprint)
    }
  }, 90_000)

  it('re-running with unchanged specs is a deterministic no-op (no flow re-authors)', async () => {
    const r = repo()
    writeApiRecipe(r, { entry: null })
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, OPENAPI)

    let authorCalls = 0
    const runner = {
      interfaces: todoInterfaces(r),
      extractRunner: extractBy({
        'paths/get-listtodos': [{ driver: 'api', claim: 'GET /todos returns 200 with the todo list', reason: 'HTTP status + body' }],
        'paths/get-gethealth': { untestable: 'probe' },
        'paths/post-createtodo': { untestable: 'covered' },
        'paths/get-gettodo': { untestable: 'covered' },
        'paths/patch-updatetodo': { untestable: 'covered' },
        'paths/delete-deletetodo': { untestable: 'covered' },
      }),
      generateRunner: authorBy(
        { 'paths-get-listtodos': rawApi('GET /todos answers 200 with the empty list', LIST_STEPS) },
        () => authorCalls++,
      ),
    }
    const first = await runGenerate({ repoRoot: r, ...runner })
    expect(first.written).toHaveLength(1)
    expect(authorCalls).toBe(1)

    // Nothing moved, so every flow's inputs hash still matches the manifest: the run
    // authors nothing, writes nothing, and reports itself as a no-op.
    const second = await runGenerate({ repoRoot: r, ...runner })
    expect(second.noChanges).toBe(true)
    expect(second.written).toEqual([])
    expect(second.flows).toMatchObject({ total: 1, skipped: 1, settled: 1, unsettled: 0 })
    expect(authorCalls).toBe(1) // no second authoring call
    // The committed scenario stands, its manifest entry carried forward.
    expect(readManifest(r)!.flows.find((f) => f.flowId === 'paths-get-listtodos')!.scenarios).toEqual([
      { id: 'paths-get-listtodos.api.1', drivers: ['api'], status: 'passing' },
    ])
  }, 90_000)
})
