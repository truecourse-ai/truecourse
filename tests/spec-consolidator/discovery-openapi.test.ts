import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  discoverDocs,
  isStructuralSpecDoc,
  prefilterDocs,
} from '../../packages/spec-consolidator/src/index.js'
import { runSpecScanSessions } from '../../packages/core/src/services/spec-scan/run'
import { memoryPersistence, stubDriver } from '../core/spec-scan-session-stub'

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

describe('OpenAPI docs bypass the prose prefilter entirely', () => {
  it('the prefilter neither classifies nor skips an OpenAPI doc', () => {
    place('api/openapi.yaml', OPENAPI)
    place('docs/spec.md', '# Spec\n\nProse.\n')
    const docs = discoverDocs(root, { skipGit: true })

    const { toClassify, skipped } = prefilterDocs(docs, [], null)
    // Structural specs are admitted deterministically upstream: they are neither
    // curated by a session nor listed as skipped — the single prefilter the run
    // and the pre-flight estimate share, so the two can never disagree on cost.
    expect(toClassify.map((d) => d.path)).not.toContain('api/openapi.yaml')
    expect(skipped.map((s) => s.path)).not.toContain('api/openapi.yaml')
    expect(toClassify.map((d) => d.path)).toContain('docs/spec.md')
  })
})

describe('the scan run — an OpenAPI doc lands in the corpus with empty area tags', () => {
  it('admits it deterministically, spending no curate-doc session on it', async () => {
    place('api/openapi.yaml', OPENAPI)
    const stub = stubDriver(() => {
      throw new Error('an OpenAPI doc must never reach a session')
    })
    const res = await runSpecScanSessions({
      repoRoot: root,
      driver: async () => stub.driver,
      persistence: memoryPersistence().persistence,
      decisions: {
        version: 2,
        manualIncludes: [],
        manualExcludes: [],
        manualAreas: [],
        conflictResolutions: [],
        instructions: [],
        scopeVerdicts: [
          { path: '.', verdict: 'keep', reason: 't', decidedAt: '2026-01-01T00:00:00Z', resolvedBy: 'user' },
          { path: 'api', verdict: 'keep', reason: 't', decidedAt: '2026-01-01T00:00:00Z', resolvedBy: 'user' },
        ],
      },
      repoIdentity: null,
      skipGit: true,
      disableOverlapDetection: true,
    })

    expect(stub.calls).toEqual([])
    const entry = res.corpus.docs.find((d) => d.ref === 'api/openapi.yaml')
    expect(entry).toBeDefined()
    expect(entry).toMatchObject({ kind: 'openapi', areaTags: [] })
    expect(res.corpus.skippedDocs.map((s) => s.ref)).not.toContain('api/openapi.yaml')
    expect(res.stats.docsKept).toBeGreaterThanOrEqual(1)
  })
})
