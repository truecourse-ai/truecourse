import { describe, it, expect } from 'vitest'
import {
  buildDocSectionIndex,
  extractSectionTexts,
  resolveBinding,
} from '@truecourse/guard-runner'

const TODOS = `openapi: 3.0.3
info:
  title: Todos
  version: 1.0.0
paths:
  /todos:
    get:
      operationId: listTodos
      responses:
        '200': { description: ok }
    post:
      operationId: createTodo
      responses:
        '201': { description: created }
  /todos/{id}:
    get:
      operationId: getTodo
      responses:
        '200': { description: ok }
`

describe('buildDocSectionIndex — OpenAPI docs', () => {
  it('makes one section per operation with a synthetic paths/<method>-<slug> anchor', () => {
    const idx = buildDocSectionIndex('api/openapi.yaml', TODOS)
    expect(idx.markdown).toBe(false)
    expect(idx.sections.map((s) => s.anchor)).toEqual([
      'paths/get-listtodos',
      'paths/post-createtodo',
      'paths/get-gettodo',
    ])
    expect(idx.sections.map((s) => s.headingText)).toEqual([
      'GET /todos',
      'POST /todos',
      'GET /todos/{id}',
    ])
    // No raw path ever leaks into the anchor (no fake `{id}` hierarchy level).
    for (const s of idx.sections) expect(s.anchor).not.toContain('{')
  })

  it('populates byAnchor and byFingerprint', () => {
    const idx = buildDocSectionIndex('api/openapi.yaml', TODOS)
    expect(idx.byAnchor.get('paths/get-listtodos')?.headingText).toBe('GET /todos')
    for (const s of idx.sections) {
      expect(idx.byFingerprint.get(s.fingerprint)).toContain(s)
      expect(s.fingerprint).toMatch(/^sha256:/)
    }
  })

  it('does not collide /users/{id} with /users/id — disambiguated to distinct anchors', () => {
    // Neither operation carries an operationId, so both slug from their path;
    // slugifyHeading folds `{id}` → `id`, so the base anchor collides and the
    // second takes the next `-N` ordinal (reusing the markdown disambiguation).
    const spec = `openapi: 3.0.0
info: { title: x, version: '1' }
paths:
  /users/{id}:
    get:
      responses: { '200': { description: ok } }
  /users/id:
    get:
      responses: { '200': { description: ok } }
`
    const idx = buildDocSectionIndex('api/openapi.yaml', spec)
    expect(idx.sections).toHaveLength(2)
    expect(idx.sections.map((s) => s.anchor)).toEqual(['paths/get-users-id', 'paths/get-users-id-2'])
    // Both are addressable and distinct — neither clobbered the other.
    expect(new Set(idx.sections.map((s) => s.anchor)).size).toBe(2)
    expect(idx.sections[0].fingerprint).not.toBe(idx.sections[1].fingerprint)
  })

  it('fingerprints are stable under a cosmetic source reformat / key reorder', () => {
    const reordered = `openapi: 3.0.3
paths:
  /todos:
    post:
      responses: { '201': { description: created } }
      operationId: createTodo
    get:
      responses: { '200': { description: ok } }
      operationId: listTodos
  /todos/{id}:
    get:
      operationId: getTodo
      responses: { '200': { description: ok } }
info:
  version: 1.0.0
  title: Todos
`
    const a = buildDocSectionIndex('api/openapi.yaml', TODOS)
    const b = buildDocSectionIndex('api/openapi.yaml', reordered)
    const fpOf = (idx: typeof a, anchor: string): string | undefined =>
      idx.byAnchor.get(anchor)?.fingerprint
    for (const anchor of ['paths/get-listtodos', 'paths/post-createtodo', 'paths/get-gettodo']) {
      expect(fpOf(b, anchor)).toBe(fpOf(a, anchor))
    }
  })

  it('extractSectionTexts agrees with the index on anchors and canonical fullText', () => {
    const idx = buildDocSectionIndex('api/openapi.yaml', TODOS)
    const texts = extractSectionTexts('api/openapi.yaml', TODOS)
    for (const s of idx.sections) {
      const t = texts.get(s.anchor)
      expect(t).toBeDefined()
      // fullText is the canonical operation slice; its fingerprint equals the index's.
      expect(t!.fullText).toContain('"method"')
      expect(t!.ownText).toBe(t!.fullText)
    }
  })
})

describe('resolveBinding — OpenAPI stale / orphan', () => {
  const doc = 'api/openapi.yaml'

  it('binds a matching operation', () => {
    const idx = buildDocSectionIndex(doc, TODOS)
    const s = idx.byAnchor.get('paths/get-listtodos')!
    expect(resolveBinding(idx, s.anchor, s.fingerprint)).toEqual({ kind: 'match', section: s })
  })

  it('flips scenarios stale when an operation is edited in place', () => {
    const before = buildDocSectionIndex(doc, TODOS)
    const bound = before.byAnchor.get('paths/get-gettodo')!
    // Edit only the getTodo operation (add a 404 response) — its anchor stays,
    // its canonical slice (and fingerprint) changes.
    const edited = TODOS.replace(
      `  /todos/{id}:
    get:
      operationId: getTodo
      responses:
        '200': { description: ok }`,
      `  /todos/{id}:
    get:
      operationId: getTodo
      responses:
        '200': { description: ok }
        '404': { description: not found }`,
    )
    const after = buildDocSectionIndex(doc, edited)
    const res = resolveBinding(after, bound.anchor, bound.fingerprint)
    expect(res.kind).toBe('stale')
    // The other operations' bindings still match.
    const list = before.byAnchor.get('paths/get-listtodos')!
    expect(resolveBinding(after, list.anchor, list.fingerprint).kind).toBe('match')
  })

  it('orphans scenarios when the operation is deleted', () => {
    const before = buildDocSectionIndex(doc, TODOS)
    const bound = before.byAnchor.get('paths/post-createtodo')!
    const deleted = TODOS.replace(
      `    post:
      operationId: createTodo
      responses:
        '201': { description: created }
`,
      '',
    )
    const after = buildDocSectionIndex(doc, deleted)
    expect(after.byAnchor.has('paths/post-createtodo')).toBe(false)
    expect(resolveBinding(after, bound.anchor, bound.fingerprint)).toEqual({
      kind: 'orphaned',
      anchor: bound.anchor,
    })
  })
})
