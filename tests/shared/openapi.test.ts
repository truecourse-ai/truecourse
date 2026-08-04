import { describe, it, expect } from 'vitest'
import {
  hasOpenApiExtension,
  looksLikeOpenApi,
  isOpenApiDoc,
  parseOpenApiSpec,
  deriveOpenApiSections,
  canonicalStringify,
  requestBodyJsonSchema,
  openApiServerBasePath,
  HTTP_METHODS,
} from '@truecourse/shared/openapi'

function withServers(servers: unknown): string {
  return `openapi: 3.0.3\ninfo:\n  title: T\n  version: '1'\npaths:\n  /x:\n    get:\n      responses:\n        '200':\n          description: ok\nservers: ${JSON.stringify(servers)}\n`
}

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

describe('requestBodyJsonSchema', () => {
  it('extracts the application/json request schema of an operation', () => {
    const op = {
      requestBody: {
        content: { 'application/json': { schema: { type: 'object', required: ['title'] } } },
      },
    }
    expect(requestBodyJsonSchema(op)).toEqual({ type: 'object', required: ['title'] })
  })

  it('falls back to a +json / other json media type when application/json is absent', () => {
    const op = { requestBody: { content: { 'application/merge-patch+json': { schema: { type: 'string' } } } } }
    expect(requestBodyJsonSchema(op)).toEqual({ type: 'string' })
  })

  it('returns undefined when there is no request body, no content, or no schema', () => {
    expect(requestBodyJsonSchema({})).toBeUndefined()
    expect(requestBodyJsonSchema({ requestBody: {} })).toBeUndefined()
    expect(requestBodyJsonSchema({ requestBody: { content: {} } })).toBeUndefined()
    expect(requestBodyJsonSchema({ requestBody: { content: { 'application/json': {} } } })).toBeUndefined()
    expect(requestBodyJsonSchema(null)).toBeUndefined()
    expect(requestBodyJsonSchema('nope')).toBeUndefined()
  })

  it('exports the OpenAPI HTTP methods (lowercase, stable order)', () => {
    expect(HTTP_METHODS).toContain('post')
    expect(HTTP_METHODS).toContain('get')
    expect(HTTP_METHODS).toContain('patch')
  })

  describe('openApiServerBasePath', () => {
    it('returns a path-only server url normalized', () => {
      expect(openApiServerBasePath(withServers([{ url: '/api/v1' }]))).toBe('/api/v1')
    })

    it('uses only the path portion of a full server url', () => {
      expect(openApiServerBasePath(withServers([{ url: 'https://api.example.com/api/v1' }]))).toBe('/api/v1')
    })

    it('strips a trailing slash', () => {
      expect(openApiServerBasePath(withServers([{ url: '/api/v1/' }]))).toBe('/api/v1')
      expect(openApiServerBasePath(withServers([{ url: 'https://host/api/v1/' }]))).toBe('/api/v1')
    })

    it('treats root "/" as no base path', () => {
      expect(openApiServerBasePath(withServers([{ url: '/' }]))).toBe('')
    })

    it('returns "" when a full url declares no path', () => {
      expect(openApiServerBasePath(withServers([{ url: 'https://api.example.com' }]))).toBe('')
    })

    it('returns "" when servers are absent', () => {
      expect(openApiServerBasePath(OPENAPI_YAML)).toBe('')
    })

    it('uses the first server when several are declared', () => {
      expect(openApiServerBasePath(withServers([{ url: '/api/v1' }, { url: '/api/v2' }]))).toBe('/api/v1')
    })

    it('keeps template braces in the path (so the runner wildcards them)', () => {
      expect(openApiServerBasePath(withServers([{ url: '{scheme}://host/api/{version}' }]))).toBe('/api/{version}')
    })
  })
})
