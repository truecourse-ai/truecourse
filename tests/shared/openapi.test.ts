import { describe, it, expect } from 'vitest'
import {
  hasOpenApiExtension,
  looksLikeOpenApi,
  isOpenApiDoc,
  parseOpenApiSpec,
  deriveOpenApiSections,
  canonicalStringify,
} from '@truecourse/shared/openapi'

const OPENAPI_YAML = `openapi: 3.0.3
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
`

const OPENAPI_JSON = JSON.stringify({
  openapi: '3.1.0',
  info: { title: 'x', version: '1' },
  paths: { '/ping': { get: { operationId: 'ping', responses: { '200': { description: 'ok' } } } } },
})

const SWAGGER2_YAML = `swagger: "2.0"
info:
  title: Legacy
  version: 1.0.0
paths:
  /legacy:
    get:
      responses:
        '200':
          description: ok
`

describe('openapi detection', () => {
  it('accepts openapi 3.x yaml, openapi 3.x json, and swagger 2', () => {
    expect(isOpenApiDoc('api/openapi.yaml', OPENAPI_YAML)).toBe(true)
    expect(isOpenApiDoc('api/openapi.json', OPENAPI_JSON)).toBe(true)
    expect(isOpenApiDoc('api/swagger.yml', SWAGGER2_YAML)).toBe(true)
  })

  it('rejects package.json, tsconfig.json, and a docker compose file', () => {
    const pkg = JSON.stringify({ name: 'x', version: '1.0.0', scripts: { build: 'tsc' }, dependencies: {} })
    const tsconfig = JSON.stringify({ compilerOptions: { strict: true, outDir: 'dist' } })
    const compose = `services:
  db:
    image: postgres:16
    ports:
      - 5432:5432
`
    expect(isOpenApiDoc('package.json', pkg)).toBe(false)
    expect(isOpenApiDoc('tsconfig.json', tsconfig)).toBe(false)
    expect(isOpenApiDoc('docker-compose.yaml', compose)).toBe(false)
  })

  it('rejects a spec whose extension is not yaml/yml/json even with an openapi key', () => {
    expect(hasOpenApiExtension('openapi.txt')).toBe(false)
    expect(isOpenApiDoc('openapi.txt', OPENAPI_YAML)).toBe(false)
  })

  it('the cheap head gate flags a plausible doc and clears an obvious non-doc', () => {
    expect(looksLikeOpenApi(OPENAPI_YAML.slice(0, 200))).toBe(true)
    expect(looksLikeOpenApi('{"name":"x","version":"1.0.0"}')).toBe(false)
  })

  it('parseOpenApiSpec returns the document for a spec and null otherwise', () => {
    expect(parseOpenApiSpec(OPENAPI_YAML)?.openapi).toBe('3.0.3')
    expect(parseOpenApiSpec('name: not-a-spec')).toBeNull()
    expect(parseOpenApiSpec(': : not yaml :')).toBeNull()
  })
})

describe('canonicalStringify', () => {
  it('is invariant to object key order but preserves array order', () => {
    const a = canonicalStringify({ b: 1, a: { y: 2, x: 3 }, list: [3, 1, 2] })
    const b = canonicalStringify({ a: { x: 3, y: 2 }, list: [3, 1, 2], b: 1 })
    expect(a).toBe(b)
    expect(a).toContain('"list":[3,1,2]')
  })
})

describe('deriveOpenApiSections', () => {
  it('derives one section per operation with a canonical resolved slice', () => {
    const secs = deriveOpenApiSections(OPENAPI_YAML)
    expect(secs).toHaveLength(1)
    expect(secs[0]).toMatchObject({
      method: 'get',
      routePath: '/todos',
      operationId: 'listTodos',
      headingText: 'GET /todos',
    })
    // The canonical text is the sorted-key JSON of { method, path, operation }.
    expect(secs[0].canonicalText).toContain('"method":"get"')
    expect(secs[0].canonicalText).toContain('"path":"/todos"')
  })

  it('dereferences in-file $refs into the operation slice', () => {
    const spec = `openapi: 3.0.0
info: { title: x, version: '1' }
paths:
  /todos:
    post:
      operationId: createTodo
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/NewTodo'
      responses:
        '201':
          description: created
components:
  schemas:
    NewTodo:
      type: object
      required: [title]
      properties:
        title: { type: string }
`
    const [sec] = deriveOpenApiSections(spec)
    // The $ref is resolved inline — the schema's shape appears, not the pointer.
    expect(sec.canonicalText).not.toContain('$ref')
    expect(sec.canonicalText).toContain('"required":["title"]')
  })

  it('produces byte-identical canonical text under source reformat / key reorder', () => {
    const reordered = `openapi: 3.0.3
paths:
  /todos:
    get:
      responses:
        '200': { description: ok }
      operationId: listTodos
info:
  version: 1.0.0
  title: Todos
`
    const [a] = deriveOpenApiSections(OPENAPI_YAML)
    const [b] = deriveOpenApiSections(reordered)
    expect(b.canonicalText).toBe(a.canonicalText)
  })

  it('leaves an external $ref untouched (in-file deref only)', () => {
    const spec = `openapi: 3.0.0
info: { title: x, version: '1' }
paths:
  /x:
    get:
      operationId: getX
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: 'other.yaml#/Thing'
`
    const [sec] = deriveOpenApiSections(spec)
    expect(sec.canonicalText).toContain('other.yaml#/Thing')
  })

  it('returns [] for a non-openapi document', () => {
    expect(deriveOpenApiSections('name: not-a-spec')).toEqual([])
  })
})
