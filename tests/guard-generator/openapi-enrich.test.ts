import { describe, it, expect } from 'vitest'
import { canonicalStringify } from '@truecourse/shared/openapi'
import {
  parseOperationSection,
  buildOperationIndex,
  matchOperationsForSection,
  matchedSchemaFingerprint,
  type SectionInput,
} from '@truecourse/guard-generator'

/** A section whose fullText is the canonical `{ method, path, operation }` slice
 *  (exactly what deriveOpenApiSections materializes for an OpenAPI operation). */
function opSection(
  anchor: string,
  method: string,
  path: string,
  operation: Record<string, unknown>,
  fingerprint = `sha256:${anchor}`,
): SectionInput {
  return {
    doc: 'api/openapi.yaml',
    anchor,
    fingerprint,
    headingText: `${method.toUpperCase()} ${path}`,
    level: 0,
    ownText: '',
    fullText: canonicalStringify({ method, path, operation }),
    areaTags: [],
    suppressionFingerprint: '',
    endpointSchemaFingerprint: '',
  }
}

/** A markdown prose section. */
function mdSection(anchor: string, fullText: string): SectionInput {
  return {
    doc: 'docs/api.md',
    anchor,
    fingerprint: `sha256:${anchor}`,
    headingText: anchor,
    level: 2,
    ownText: fullText,
    fullText,
    areaTags: [],
    suppressionFingerprint: '',
    endpointSchemaFingerprint: '',
  }
}

const NEW_TODO_SCHEMA = { type: 'object', required: ['title'], properties: { title: { type: 'string' } } }

const POST_TODOS = opSection('paths/post-todos', 'post', '/v2/bookings', {
  requestBody: { content: { 'application/json': { schema: NEW_TODO_SCHEMA } } },
})
const GET_TODOS = opSection('paths/get-todos', 'get', '/v2/bookings', {
  responses: { '200': { description: 'ok' } },
})
const DELETE_TODO = opSection('paths/delete-todo', 'delete', '/v2/bookings/{id}', {
  responses: { '204': { description: 'gone' } },
})
const PATCH_TODO = opSection('paths/patch-todo', 'patch', '/v2/bookings/{id}', {
  requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { done: { type: 'boolean' } } } } } },
})

describe('parseOperationSection', () => {
  it('parses an OpenAPI operation section into an entry (write op carries requestSchema)', () => {
    const e = parseOperationSection(POST_TODOS)
    expect(e).toMatchObject({ anchor: 'paths/post-todos', method: 'POST', path: '/v2/bookings' })
    expect(e?.requestSchema).toEqual(NEW_TODO_SCHEMA)
  })

  it('returns null for a markdown (non-JSON) section', () => {
    expect(parseOperationSection(mdSection('overview', '## Overview\nPOST /v2/bookings creates a booking.'))).toBeNull()
  })

  it('returns null for JSON of the wrong shape (no method/path/operation)', () => {
    const s = mdSection('cfg', JSON.stringify({ foo: 'bar', path: '/x' }))
    expect(parseOperationSection(s)).toBeNull()
  })

  it('does not carry a requestSchema on a GET / DELETE operation', () => {
    expect(parseOperationSection(GET_TODOS)?.requestSchema).toBeUndefined()
    expect(parseOperationSection(DELETE_TODO)?.requestSchema).toBeUndefined()
  })
})

describe('buildOperationIndex', () => {
  it('keeps only the operation sections across docs and carries their fingerprints', () => {
    const index = buildOperationIndex([POST_TODOS, mdSection('overview', '## Overview'), GET_TODOS])
    expect(index.map((e) => e.anchor)).toEqual(['paths/post-todos', 'paths/get-todos'])
    expect(index.find((e) => e.anchor === 'paths/post-todos')?.fingerprint).toBe('sha256:paths/post-todos')
  })
})

describe('matchOperationsForSection', () => {
  const index = buildOperationIndex([POST_TODOS, GET_TODOS, DELETE_TODO, PATCH_TODO])

  it('matches an exact `POST /v2/bookings` prose reference', () => {
    const matched = matchOperationsForSection(mdSection('c', 'Clients call `POST /v2/bookings` to create a booking.'), index)
    expect(matched.map((e) => e.anchor)).toEqual(['paths/post-todos'])
  })

  it('folds a concrete path segment to the `{id}` template (:id / <id> / digits)', () => {
    for (const ref of ['PATCH /v2/bookings/123', 'PATCH /v2/bookings/:id', 'PATCH /v2/bookings/<id>']) {
      const matched = matchOperationsForSection(mdSection('c', `Do a ${ref} to update.`), index)
      expect(matched.map((e) => e.anchor)).toEqual(['paths/patch-todo'])
    }
  })

  it('does not match a bare path with no method token', () => {
    expect(matchOperationsForSection(mdSection('c', 'The /v2/bookings resource lists bookings.'), index)).toEqual([])
  })

  it('strips trailing sentence punctuation glued to the path (`…to /v2/bookings.`)', () => {
    for (const ref of ['POST /v2/bookings.', 'POST /v2/bookings,', 'POST /v2/bookings;', 'POST /v2/bookings:']) {
      const matched = matchOperationsForSection(mdSection('c', `Clients POST to ${ref}`), index)
      expect(matched.map((e) => e.anchor)).toEqual(['paths/post-todos'])
    }
  })

  it('skips an ambiguous reference that matches two operations', () => {
    const a = opSection('paths/a', 'get', '/items/{id}', { responses: {} })
    const b = opSection('paths/b', 'get', '/items/{name}', { responses: {} })
    const ambiguous = buildOperationIndex([a, b])
    expect(matchOperationsForSection(mdSection('c', 'Call `GET /items/42`.'), ambiguous)).toEqual([])
  })

  it('a GET reference matches its operation but that op carries no requestSchema', () => {
    const matched = matchOperationsForSection(mdSection('c', 'A `GET /v2/bookings` lists them.'), index)
    expect(matched.map((e) => e.anchor)).toEqual(['paths/get-todos'])
    expect(matched[0].requestSchema).toBeUndefined()
  })
})

describe('matchedSchemaFingerprint', () => {
  const index = buildOperationIndex([POST_TODOS, GET_TODOS, PATCH_TODO])

  it('is empty for a section with no write-op match (byte-identity guarantee)', () => {
    expect(matchedSchemaFingerprint(mdSection('c', 'A `GET /v2/bookings` lists them.'), index)).toBe('')
    expect(matchedSchemaFingerprint(mdSection('c', 'No endpoints here at all.'), index)).toBe('')
  })

  it('is non-empty for a section matching a write op, and moves when the op fingerprint changes', () => {
    const section = mdSection('c', 'Create with `POST /v2/bookings`.')
    const fp1 = matchedSchemaFingerprint(section, index)
    expect(fp1).toMatch(/^sha256:/)
    const changed = buildOperationIndex([
      { ...POST_TODOS, fingerprint: 'sha256:post-todos-v2' },
      GET_TODOS,
      PATCH_TODO,
    ])
    expect(matchedSchemaFingerprint(section, changed)).not.toBe(fp1)
  })
})
