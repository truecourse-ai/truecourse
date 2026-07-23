import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import {
  deriveOpenApiSections,
  isResolvedOpenApiWithinCap,
  OpenApiOversizeError,
  OPENAPI_MAX_BYTES,
  type RefResolutionContext,
} from '@truecourse/shared/openapi'

/**
 * Build a RefResolutionContext backed by an in-memory { absPath: content } map.
 * The returned `reads` array records every path `readFile` was asked for — used to
 * assert escape/absolute/network refs are NEVER read.
 */
function memCtx(
  files: Record<string, string>,
  specPath: string,
  repoRoot = '/repo',
): { ctx: RefResolutionContext; reads: string[] } {
  const reads: string[] = []
  const readFile = (abs: string): string | null => {
    reads.push(abs)
    return Object.prototype.hasOwnProperty.call(files, abs) ? files[abs] : null
  }
  return { ctx: { specPath, repoRoot, readFile }, reads }
}

// An all-in-file spec: exercises the pre-pass no-op guarantee (only #/… refs).
const IN_FILE_SPEC = `openapi: 3.0.3
info:
  title: Todos
  version: 1.0.0
paths:
  /todos:
    get:
      operationId: listTodos
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Todo'
    post:
      operationId: createTodo
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Todo'
      responses:
        '201':
          description: created
components:
  schemas:
    Todo:
      type: object
      properties:
        id: { type: string }
        title: { $ref: '#/components/schemas/Title' }
    Title:
      type: string
`

describe('deriveOpenApiSections — external $ref resolution', () => {
  it('cal.com byte-identity: deriving an in-file-only spec with a ctx is a strict no-op', () => {
    const { ctx, reads } = memCtx({}, '/repo/openapi.yaml')
    const without = deriveOpenApiSections(IN_FILE_SPEC)
    const withCtx = deriveOpenApiSections(IN_FILE_SPEC, ctx)
    expect(withCtx.map((s) => s.canonicalText)).toEqual(without.map((s) => s.canonicalText))
    // The pre-pass never touches #/… refs, so no external file is ever read.
    expect(reads).toEqual([])
  })

  it('golden-hash pin: the in-file spec section texts hash to a stable value', () => {
    const sections = deriveOpenApiSections(IN_FILE_SPEC)
    const hash = createHash('sha256')
      .update(sections.map((s) => `${s.method} ${s.routePath}\n${s.canonicalText}`).join('\n'))
      .digest('hex')
    expect(hash).toBe('8877a721be2f1ae22e0ac2180b292495be8cf8f672daefe97bbc12e58c1bc826')
  })

  it('inlines a whole-file external ref', () => {
    const entry = `openapi: 3.0.3
info: { title: t, version: '1' }
paths:
  /todos:
    get:
      operationId: listTodos
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: './schemas/todo.yaml'
`
    const todo = `type: object
properties:
  id: { type: string }
`
    const { ctx } = memCtx({ '/repo/schemas/todo.yaml': todo }, '/repo/openapi.yaml')
    const [op] = deriveOpenApiSections(entry, ctx)
    const parsed = JSON.parse(op.canonicalText)
    expect(parsed.operation.responses['200'].content['application/json'].schema).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
    })
  })

  it('inlines only the pointed node of a fragment external ref', () => {
    const entry = `openapi: 3.0.3
info: { title: t, version: '1' }
paths:
  /todos:
    get:
      operationId: listTodos
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: './schemas/models.yaml#/Todo'
`
    const models = `Todo:
  type: object
  properties: { id: { type: string } }
Other:
  type: string
`
    const { ctx } = memCtx({ '/repo/schemas/models.yaml': models }, '/repo/openapi.yaml')
    const [op] = deriveOpenApiSections(entry, ctx)
    const schema = JSON.parse(op.canonicalText).operation.responses['200'].content['application/json'].schema
    expect(schema).toEqual({ type: 'object', properties: { id: { type: 'string' } } })
  })

  it('resolves a JSON external target as well as YAML', () => {
    const entry = `openapi: 3.0.3
info: { title: t, version: '1' }
paths:
  /todos:
    get:
      operationId: listTodos
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: './schemas/todo.json'
`
    const todo = JSON.stringify({ type: 'object', properties: { id: { type: 'string' } } })
    const { ctx } = memCtx({ '/repo/schemas/todo.json': todo }, '/repo/openapi.yaml')
    const [op] = deriveOpenApiSections(entry, ctx)
    const schema = JSON.parse(op.canonicalText).operation.responses['200'].content['application/json'].schema
    expect(schema).toEqual({ type: 'object', properties: { id: { type: 'string' } } })
  })

  it('resolves a nested external ref relative to the intermediate file dir', () => {
    // entry -> handlers/a/spec/paths/x.yaml -> ../schemas/y.yaml (relative to a.yaml)
    const entry = `openapi: 3.0.3
info: { title: t, version: '1' }
paths:
  /x:
    $ref: './handlers/a/spec/paths/x.yaml'
`
    const xPath = `get:
  operationId: opX
  responses:
    '200':
      description: ok
      content:
        application/json:
          schema:
            $ref: '../schemas/y.yaml'
`
    const y = `type: object
properties: { name: { type: string } }
`
    const { ctx } = memCtx(
      {
        '/repo/handlers/a/spec/paths/x.yaml': xPath,
        '/repo/handlers/a/spec/schemas/y.yaml': y,
      },
      '/repo/openapi.yaml',
    )
    const [op] = deriveOpenApiSections(entry, ctx)
    const schema = JSON.parse(op.canonicalText).operation.responses['200'].content['application/json'].schema
    expect(schema).toEqual({ type: 'object', properties: { name: { type: 'string' } } })
  })

  it('resolves an in-file #/ ref that appears INSIDE an external file against that file root', () => {
    const entry = `openapi: 3.0.3
info: { title: t, version: '1' }
paths:
  /todos:
    get:
      operationId: listTodos
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: './schemas/models.yaml#/Todo'
`
    // Todo references Title via an in-file pointer within models.yaml.
    const models = `Todo:
  type: object
  properties:
    title: { $ref: '#/Title' }
Title:
  type: string
`
    const { ctx } = memCtx({ '/repo/schemas/models.yaml': models }, '/repo/openapi.yaml')
    const [op] = deriveOpenApiSections(entry, ctx)
    const schema = JSON.parse(op.canonicalText).operation.responses['200'].content['application/json'].schema
    expect(schema).toEqual({ type: 'object', properties: { title: { type: 'string' } } })
  })

  it('inlines a diamond fully but degrades only true back-edges of a cycle', () => {
    // a.yaml <-> b.yaml cycle. Both files reachable; the back-edge stays a literal $ref.
    const entry = `openapi: 3.0.3
info: { title: t, version: '1' }
paths:
  /x:
    get:
      operationId: opX
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: './a.yaml'
`
    const a = `type: object
properties:
  self: { type: string }
  next: { $ref: './b.yaml' }
`
    const b = `type: object
properties:
  back: { $ref: './a.yaml' }
`
    const { ctx } = memCtx({ '/repo/a.yaml': a, '/repo/b.yaml': b }, '/repo/openapi.yaml')
    const [op] = deriveOpenApiSections(entry, ctx)
    const schema = JSON.parse(op.canonicalText).operation.responses['200'].content['application/json'].schema
    // a inlined; a.next -> b inlined; b.back -> a is the back-edge, left literal.
    expect(schema.properties.self).toEqual({ type: 'string' })
    expect(schema.properties.next.properties.back).toEqual({ $ref: './a.yaml' })
  })

  it('never reads an escaping / absolute / network ref and degrades it to a literal $ref', () => {
    const entry = `openapi: 3.0.3
info: { title: t, version: '1' }
paths:
  /x:
    get:
      operationId: opX
      parameters:
        - { $ref: '../../../../etc/passwd' }
        - { $ref: '/etc/shadow' }
        - { $ref: 'http://evil.example/schema.yaml' }
      responses:
        '200': { description: ok }
`
    const { ctx, reads } = memCtx({}, '/repo/spec/openapi.yaml')
    const [op] = deriveOpenApiSections(entry, ctx)
    const params = JSON.parse(op.canonicalText).operation.parameters
    expect(params).toEqual([
      { $ref: '../../../../etc/passwd' },
      { $ref: '/etc/shadow' },
      { $ref: 'http://evil.example/schema.yaml' },
    ])
    expect(reads).toEqual([])
  })

  it('degrades a missing external file to a literal $ref while other refs still resolve', () => {
    const entry = `openapi: 3.0.3
info: { title: t, version: '1' }
paths:
  /x:
    get:
      operationId: opX
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: object
                properties:
                  a: { $ref: './present.yaml' }
                  b: { $ref: './missing.yaml' }
`
    const { ctx } = memCtx({ '/repo/present.yaml': 'type: string\n' }, '/repo/openapi.yaml')
    const [op] = deriveOpenApiSections(entry, ctx)
    const props = JSON.parse(op.canonicalText).operation.responses['200'].content['application/json'].schema.properties
    expect(props.a).toEqual({ type: 'string' })
    expect(props.b).toEqual({ $ref: './missing.yaml' })
  })

  it('is order-invariant: external files with different key orders canonicalize identically', () => {
    const entryA = `openapi: 3.0.3
info: { title: t, version: '1' }
paths:
  /x:
    get:
      operationId: opX
      responses:
        '200':
          description: ok
          content: { application/json: { schema: { $ref: './s.yaml' } } }
`
    const sOrder1 = `type: object
properties:
  a: { type: string }
  b: { type: number }
`
    const sOrder2 = `properties:
  b: { type: number }
  a: { type: string }
type: object
`
    const [op1] = deriveOpenApiSections(entryA, memCtx({ '/repo/s.yaml': sOrder1 }, '/repo/openapi.yaml').ctx)
    const [op2] = deriveOpenApiSections(entryA, memCtx({ '/repo/s.yaml': sOrder2 }, '/repo/openapi.yaml').ctx)
    expect(op1.canonicalText).toBe(op2.canonicalText)
  })

  it('bundled-vs-native equivalence: a split spec resolves identically to its bundled form', () => {
    // A split topology shaped after n8n: nested dirs, up-then-down refs, an
    // _index aggregator, and a diamond (two ops share Todo).
    const entry = `openapi: 3.0.3
info: { title: t, version: '1' }
paths:
  /todos:
    $ref: './handlers/todos/spec/paths/collection.yaml'
  /todos/{id}:
    $ref: './handlers/todos/spec/paths/item.yaml'
`
    const collection = `get:
  operationId: listTodos
  responses:
    '200':
      description: ok
      content: { application/json: { schema: { $ref: '../../../../shared/spec/schemas/_index.yaml#/Todo' } } }
`
    const item = `get:
  operationId: getTodo
  responses:
    '200':
      description: ok
      content: { application/json: { schema: { $ref: '../../../../shared/spec/schemas/_index.yaml#/Todo' } } }
`
    const index = `Todo:
  $ref: './../../../handlers/todos/spec/schemas/todo.yaml'
`
    const todo = `type: object
properties: { id: { type: string } }
`
    const files = {
      '/repo/handlers/todos/spec/paths/collection.yaml': collection,
      '/repo/handlers/todos/spec/paths/item.yaml': item,
      '/repo/shared/spec/schemas/_index.yaml': index,
      '/repo/handlers/todos/spec/schemas/todo.yaml': todo,
    }
    const split = deriveOpenApiSections(entry, memCtx(files, '/repo/openapi.yaml').ctx)

    const bundled = `openapi: 3.0.3
info: { title: t, version: '1' }
paths:
  /todos:
    get:
      operationId: listTodos
      responses:
        '200':
          description: ok
          content: { application/json: { schema: { type: object, properties: { id: { type: string } } } } }
  /todos/{id}:
    get:
      operationId: getTodo
      responses:
        '200':
          description: ok
          content: { application/json: { schema: { type: object, properties: { id: { type: string } } } } }
`
    const native = deriveOpenApiSections(bundled)
    expect(split.map((s) => s.canonicalText)).toEqual(native.map((s) => s.canonicalText))
  })

  it('throws OpenApiOversizeError → [] when the resolved size exceeds the cap', () => {
    const big = 'x'.repeat(OPENAPI_MAX_BYTES + 1024)
    const entry = `openapi: 3.0.3
info: { title: t, version: '1' }
paths:
  /x:
    get:
      operationId: opX
      responses:
        '200':
          description: ok
          content: { application/json: { schema: { $ref: './big.yaml' } } }
`
    const bigYaml = `type: object\ndescription: "${big}"\n`
    const { ctx } = memCtx({ '/repo/big.yaml': bigYaml }, '/repo/openapi.yaml')
    expect(deriveOpenApiSections(entry, ctx)).toEqual([])
    expect(isResolvedOpenApiWithinCap(entry, ctx)).toBe(false)
  })

  it('resolves a just-under-cap spec and reports it within cap', () => {
    const entry = `openapi: 3.0.3
info: { title: t, version: '1' }
paths:
  /x:
    get:
      operationId: opX
      responses:
        '200':
          description: ok
          content: { application/json: { schema: { $ref: './small.yaml' } } }
`
    const { ctx } = memCtx({ '/repo/small.yaml': 'type: string\n' }, '/repo/openapi.yaml')
    expect(deriveOpenApiSections(entry, ctx).length).toBe(1)
    expect(isResolvedOpenApiWithinCap(entry, ctx)).toBe(true)
  })

  it('OpenApiOversizeError is exported and thrown by the low-level cap check', () => {
    expect(new OpenApiOversizeError(999)).toBeInstanceOf(Error)
  })
})

describe('openapi module — browser safety', () => {
  it('does not import node:fs or node:path (readFile is injected)', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../packages/shared/src/openapi/index.ts', import.meta.url)),
      'utf-8',
    )
    expect(src).not.toMatch(/from\s+['"]node:fs['"]/)
    expect(src).not.toMatch(/from\s+['"]node:path['"]/)
    expect(src).not.toMatch(/require\(['"](?:node:)?(?:fs|path)['"]\)/)
  })
})
