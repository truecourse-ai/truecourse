import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { generateGuards } from '@truecourse/guard-generator'
import { readManifest, buildDocSectionIndex } from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeApiRecipe, writeCorpus, writeDoc, extractBy, authorBy, rawApi } from './helpers.js'

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

describe('generateGuards — OpenAPI doc as claim source (end to end)', () => {
  it('extracts api claims per operation, authors, and births them against the fixture server', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, OPENAPI)

    const res = await generateGuards({
      repoRoot: r,
      extractRunner: extractBy({
        'paths/get-listtodos': [{ driver: 'api', claim: 'GET /todos returns 200 with the todo list', reason: 'HTTP status + body' }],
        'paths/post-createtodo': [{ driver: 'api', claim: 'POST /todos creates a todo and returns 201', reason: 'HTTP status + body' }],
        'paths/get-gethealth': { untestable: 'liveness probe, covered by ops' },
        'paths/get-gettodo': { untestable: 'covered by list' },
        'paths/patch-updatetodo': { untestable: 'covered by list' },
        'paths/delete-deletetodo': { untestable: 'covered by list' },
      }),
      generateRunner: authorBy({
        'paths/get-listtodos': [rawApi('GET /todos answers 200 with the empty list', LIST_STEPS)],
        'paths/post-createtodo': [rawApi('POST /todos creates a todo (201)', CREATE_STEPS)],
      }),
    })

    expect(res.status).toBe('ok')
    expect(res.errors).toEqual([])
    expect(res.birthFindings).toEqual([])
    expect(res.written.map((w) => w.anchor).sort()).toEqual(['paths/get-listtodos', 'paths/post-createtodo'])

    // Both committed scenarios are valid api-driver YAML.
    for (const w of res.written) {
      const committed = yaml.load(fs.readFileSync(path.join(r, w.file), 'utf-8')) as { driver: string; binds: { doc: string; section: string; fingerprint: string } }
      expect(committed.driver).toBe('api')
      expect(committed.binds.doc).toBe(DOC)
      expect(committed.binds.section.startsWith('paths/')).toBe(true)
    }

    // The manifest classifies the operations under the api driver, and its
    // fingerprints are byte-identical to what a run derives (generate == run).
    const manifest = readManifest(r)!
    const index = buildDocSectionIndex(DOC, OPENAPI)
    for (const anchor of ['paths/get-listtodos', 'paths/post-createtodo']) {
      const sec = manifest.sections.find((s) => s.anchor === anchor)!
      expect(sec.classification).toMatchObject({ driver: 'api' })
      expect(sec.fingerprint).toBe(index.byAnchor.get(anchor)!.fingerprint)
    }
  }, 90_000)

  it('re-running with unchanged specs is a deterministic no-op (no work)', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, OPENAPI)

    const runner = {
      extractRunner: extractBy({
        'paths/get-listtodos': [{ driver: 'api', claim: 'GET /todos returns 200 with the todo list', reason: 'HTTP status + body' }],
        'paths/get-gethealth': { untestable: 'probe' },
        'paths/post-createtodo': { untestable: 'covered' },
        'paths/get-gettodo': { untestable: 'covered' },
        'paths/patch-updatetodo': { untestable: 'covered' },
        'paths/delete-deletetodo': { untestable: 'covered' },
      }),
      generateRunner: authorBy({
        'paths/get-listtodos': [rawApi('GET /todos answers 200 with the empty list', LIST_STEPS)],
      }),
    }
    await generateGuards({ repoRoot: r, ...runner })
    const second = await generateGuards({ repoRoot: r, ...runner })
    expect(second.noChanges).toBe(true)
    expect(second.sectionsChanged).toBe(0)
  }, 90_000)
})
