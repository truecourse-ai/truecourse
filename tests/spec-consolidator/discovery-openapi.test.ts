import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  discoverDocs,
  isStructuralSpecDoc,
  planRelevanceWork,
  filterByRelevance,
  curate,
} from '../../packages/spec-consolidator/src/index.js'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-oa-disc-'))
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function place(rel: string, body: string): void {
  const full = path.join(root, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, body)
}

const OPENAPI = `openapi: 3.0.3
info: { title: Todos, version: 1.0.0 }
paths:
  /todos:
    get:
      operationId: listTodos
      responses: { '200': { description: ok } }
`

describe('discoverDocs — OpenAPI admission', () => {
  it('discovers an openapi yaml as kind openapi and leaves manifests/lockfiles out', () => {
    place('api/openapi.yaml', OPENAPI)
    place('docs/spec.md', '# Spec\n\nProse.\n')
    place('package.json', JSON.stringify({ name: 'x', version: '1.0.0', scripts: { build: 'tsc' } }))
    place('tsconfig.json', JSON.stringify({ compilerOptions: { strict: true } }))
    place('pnpm-lock.yaml', "lockfileVersion: '9.0'\npackages: {}\n")

    const docs = discoverDocs(root, { skipGit: true })
    const byPath = new Map(docs.map((d) => [d.path, d]))
    expect(byPath.get('api/openapi.yaml')?.kind).toBe('openapi')
    expect(byPath.has('docs/spec.md')).toBe(true)
    // No json/yaml manifest or lockfile is admitted.
    expect(byPath.has('package.json')).toBe(false)
    expect(byPath.has('tsconfig.json')).toBe(false)
    expect(byPath.has('pnpm-lock.yaml')).toBe(false)
    expect(isStructuralSpecDoc(byPath.get('api/openapi.yaml')!)).toBe(true)
  })
})

describe('discoverDocs — split-spec resolved-size admission (B6)', () => {
  const SPLIT_ENTRY = `openapi: 3.0.3
info: { title: Todos, version: 1.0.0 }
paths:
  /todos:
    get:
      operationId: listTodos
      responses:
        '200':
          description: ok
          content: { application/json: { schema: { $ref: './schemas/todo.yaml' } } }
`

  it('admits a within-cap split spec whose external $refs inline under the cap', () => {
    place('api/openapi.yaml', SPLIT_ENTRY)
    place('api/schemas/todo.yaml', 'type: object\nproperties: { id: { type: string } }\n')
    const docs = discoverDocs(root, { skipGit: true })
    const byPath = new Map(docs.map((d) => [d.path, d]))
    expect(byPath.get('api/openapi.yaml')?.kind).toBe('openapi')
  })

  it('refuses a split spec whose external $refs CUMULATIVELY inline over the cap', () => {
    // Several files, each individually under the per-file guard, that together
    // exceed the 5MB resolved cap — the authoritative cumulative accounting in the
    // shared resolver throws, so the spec is refused. (A single >5MB file would be
    // stopped earlier by the wrapper's stat guard and merely degrade its own ref.)
    const twoMb = 'x'.repeat(2 * 1024 * 1024)
    place(
      'api/openapi.yaml',
      `openapi: 3.0.3
info: { title: Todos, version: 1.0.0 }
paths:
  /a:
    get:
      operationId: a
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: object
                properties:
                  one: { $ref: './schemas/one.yaml' }
                  two: { $ref: './schemas/two.yaml' }
                  three: { $ref: './schemas/three.yaml' }
`,
    )
    place('api/schemas/one.yaml', `type: object\ndescription: "${twoMb}"\n`)
    place('api/schemas/two.yaml', `type: object\ndescription: "${twoMb}"\n`)
    place('api/schemas/three.yaml', `type: object\ndescription: "${twoMb}"\n`)
    const docs = discoverDocs(root, { skipGit: true })
    const byPath = new Map(docs.map((d) => [d.path, d]))
    // Not admitted — same refusal the pre-flight estimate makes (both go through
    // discoverDocs → makeOpenApiCandidate), so estimate and runtime agree.
    expect(byPath.has('api/openapi.yaml')).toBe(false)
  })
})

describe('relevance — OpenAPI docs skip the filter identically for run and estimate', () => {
  it('planRelevanceWork never classifies an OpenAPI doc (zero calls for it)', async () => {
    place('api/openapi.yaml', OPENAPI)
    place('docs/spec.md', '# Spec\n\nProse.\n')
    const docs = discoverDocs(root, { skipGit: true })

    const plan = await planRelevanceWork(root, docs, { identity: null })
    const paths = (arr: { path: string }[]): string[] => arr.map((d) => d.path)
    expect(paths(plan.toClassify)).not.toContain('api/openapi.yaml')
    expect(paths(plan.needsCall)).not.toContain('api/openapi.yaml')
    expect(plan.prefilterSkipped.map((s) => s.path)).not.toContain('api/openapi.yaml')
    // The prose doc IS in the classify universe.
    expect(paths(plan.toClassify)).toContain('docs/spec.md')
  })

  it('filterByRelevance includes the OpenAPI doc without ever calling the classifier', async () => {
    place('api/openapi.yaml', OPENAPI)
    const docs = discoverDocs(root, { skipGit: true })
    let calls = 0
    const outcome = await filterByRelevance(root, docs, {
      identity: null,
      runner: async ({ doc }) => {
        calls++
        return { path: doc.path, include: true, reason: 'stub' }
      },
    })
    expect(calls).toBe(0)
    expect(outcome.included.map((d) => d.path)).toContain('api/openapi.yaml')
    expect(outcome.skipped).toEqual([])
  })
})

describe('curate — OpenAPI doc lands in the corpus with empty area tags', () => {
  it('admits the OpenAPI doc deterministically, bypassing the prose stages', async () => {
    place('api/openapi.yaml', OPENAPI)
    const res = await curate(root, {
      skipGit: true,
      disableRelevanceFilter: true,
      disableAreaTagging: true,
      disableVocabNormalization: true,
      disableOverlapDetection: true,
    })
    const entry = res.corpus.docs.find((d) => d.ref === 'api/openapi.yaml')
    expect(entry).toBeDefined()
    expect(entry).toMatchObject({ kind: 'openapi', areaTags: [] })
    expect(res.corpus.skippedDocs.map((s) => s.ref)).not.toContain('api/openapi.yaml')
    expect(res.stats.docsKept).toBeGreaterThanOrEqual(1)
  })
})
