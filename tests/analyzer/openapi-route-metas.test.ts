/**
 * The `openapi: { method, path }` meta literal — the REST address an RPC
 * procedure also answers at, declared beside the procedure instead of in a route
 * table. documenso's entire public API is 89 of these and no route registrations
 * at all; before this reader the api derivation saw zero of them.
 */

import { describe, it, expect } from 'vitest'
import { extractOpenApiRouteMetas } from '../../packages/analyzer/src/extractors/openapi-route-metas'
import { parseCode } from '../../packages/analyzer/src/parser'

function metas(code: string) {
  return extractOpenApiRouteMetas(parseCode(code, 'typescript'), '/test.ts', 'typescript')
}

describe('extractOpenApiRouteMetas', () => {
  it('reads the method and path off a meta literal', () => {
    // documenso's shape: the meta is its own exported const, in a sibling
    // `*.types.ts`, and the procedure attaches it with `.meta(…)`.
    expect(
      metas(`
        export const distributeEnvelopeMeta: TrpcRouteMeta = {
          openapi: {
            method: 'POST',
            path: '/envelope/distribute',
            summary: 'Distribute envelope',
            tags: ['Envelope'],
          },
        };
      `),
    ).toMatchObject([{ httpMethod: 'POST', path: '/envelope/distribute', label: 'Distribute envelope' }])
  })

  it('reads a meta declared inline on the procedure', () => {
    expect(
      metas(`
        export const getFieldRoute = procedure
          .meta({ openapi: { method: 'GET', path: '/document/field/{fieldId}' } })
          .query(handler);
      `),
    ).toMatchObject([{ httpMethod: 'GET', path: '/document/field/{fieldId}' }])
  })

  it('reads several metas from one file, in source order', () => {
    expect(
      metas(`
        const a = { openapi: { method: 'GET', path: '/envelope' } };
        const b = { openapi: { method: 'POST', path: '/envelope/create' } };
      `).map((m) => `${m.httpMethod} ${m.path}`),
    ).toEqual(['GET /envelope', 'POST /envelope/create'])
  })

  it('accepts a backtick path with no interpolation', () => {
    expect(metas("const m = { openapi: { method: 'GET', path: `/folder` } };")).toMatchObject([
      { httpMethod: 'GET', path: '/folder' },
    ])
  })

  it('skips a meta whose path is interpolated — a half-resolved address is worse than none', () => {
    expect(metas('const m = { openapi: { method: `GET`, path: `/envelope/${id}` } };')).toEqual([])
  })

  it('skips a meta missing a method or a path', () => {
    expect(metas("const m = { openapi: { path: '/envelope' } };")).toEqual([])
    expect(metas("const m = { openapi: { method: 'GET' } };")).toEqual([])
  })

  it('skips a path that is not a route path', () => {
    expect(metas("const m = { openapi: { method: 'GET', path: 'envelope' } };")).toEqual([])
  })

  it('skips an unknown method — the runner has a closed verb set', () => {
    expect(metas("const m = { openapi: { method: 'TRACE', path: '/envelope' } };")).toEqual([])
  })

  it('ignores an `openapi` key that is not an operation literal', () => {
    // A config object naming the doc, not a route.
    expect(metas("const cfg = { openapi: { title: 'API', version: '2.0' } };")).toEqual([])
    expect(metas("const cfg = { openapi: true };")).toEqual([])
  })

  it('normalizes the method case', () => {
    expect(metas("const m = { openapi: { method: 'post', path: '/envelope/create' } };")).toMatchObject([
      { httpMethod: 'POST', path: '/envelope/create' },
    ])
  })
})
