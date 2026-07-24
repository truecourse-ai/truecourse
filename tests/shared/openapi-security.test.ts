import { describe, it, expect } from 'vitest'
import {
  parseSecuritySchemes,
  effectiveOperationSecurity,
  parseOpenApiSpec,
  type OpenApiDoc,
} from '@truecourse/shared/openapi'

function doc(obj: Record<string, unknown>): OpenApiDoc {
  return parseOpenApiSpec(JSON.stringify({ openapi: '3.0.0', ...obj }))!
}

describe('parseSecuritySchemes', () => {
  it('reads OpenAPI 3 components.securitySchemes', () => {
    const doc = parseOpenApiSpec(
      JSON.stringify({
        openapi: '3.0.0',
        components: {
          securitySchemes: {
            apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
            oauth: { type: 'oauth2', flows: {} },
          },
        },
      }),
    )
    expect(parseSecuritySchemes(doc)).toEqual({
      apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      oauth: { type: 'oauth2' },
    })
  })

  it('reads Swagger 2 securityDefinitions', () => {
    const doc = parseOpenApiSpec(
      JSON.stringify({
        swagger: '2.0',
        securityDefinitions: {
          apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
        },
      }),
    )
    expect(parseSecuritySchemes(doc)).toEqual({
      apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
    })
  })

  it('resolves an in-file $ref to a scheme definition', () => {
    const doc = parseOpenApiSpec(
      JSON.stringify({
        openapi: '3.0.0',
        components: {
          securitySchemes: { keyAuth: { $ref: '#/components/x/base' } },
          x: { base: { type: 'apiKey', in: 'header', name: 'X-Key' } },
        },
      }),
    )
    expect(parseSecuritySchemes(doc)).toEqual({
      keyAuth: { type: 'apiKey', in: 'header', name: 'X-Key' },
    })
  })

  it('returns an empty map for a doc that declares no security schemes', () => {
    const d = parseOpenApiSpec(JSON.stringify({ openapi: '3.0.0', paths: {} }))
    expect(parseSecuritySchemes(d)).toEqual({})
  })
})

describe('effectiveOperationSecurity', () => {
  it('flattens an operation OR-of-AND requirement to scheme-name groups', () => {
    const d = doc({ security: [{ globalKey: [] }] })
    const op = { security: [{ apiKeyAuth: [] }, { basicAuth: [], bearerAuth: [] }] }
    expect(effectiveOperationSecurity(d, op)).toEqual([['apiKeyAuth'], ['basicAuth', 'bearerAuth']])
  })

  it('falls back to the document-level security when the operation declares none', () => {
    const d = doc({ security: [{ globalKey: [] }] })
    const op = { responses: { '200': { description: 'ok' } } }
    expect(effectiveOperationSecurity(d, op)).toEqual([['globalKey']])
  })

  it('an explicit empty operation security is PUBLIC — it overrides the doc-level default', () => {
    const d = doc({ security: [{ globalKey: [] }] })
    const op = { security: [] }
    expect(effectiveOperationSecurity(d, op)).toEqual([])
  })

  it('absent everywhere is unsecured', () => {
    const d = doc({})
    expect(effectiveOperationSecurity(d, { responses: {} })).toEqual([])
  })
})
