import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { analyzeFile } from '../../packages/source-facts/src/file-analyzer'
import { deriveApiInterfacesFromTree } from '../../packages/interface-mapper/src/api-tree'
import type { FileAnalysis } from '../../packages/shared/src/index'

// A pages-router api surface, the shape a real Next.js app's handlers take: one
// default export per file, methods told apart inside the body.
const root = path.resolve('tests/fixtures/next-pages-api')

async function analyze(...files: string[]): Promise<FileAnalysis[]> {
  const analyses = await Promise.all(files.map((file) => analyzeFile(path.join(root, file))))
  return analyses.filter((file): file is FileAnalysis => file !== null)
}

describe('Next pages-router api handlers → route registrations', () => {
  it('reads the address off the file and the methods off the body', async () => {
    const analyses = await analyze(
      'pages/api/links/index.ts',
      'pages/api/links/[id].ts',
      'pages/api/health.ts',
      'pages/api/upload/[...path].ts',
      'pages/api/tags.ts',
      'pages/api/export.ts',
      'pages/api/auth/[[...nextauth]].ts',
      'pages/api/_lib/respond.ts',
      'pages/api/notes.ts',
      'pages/api/index/index.ts',
      'pages/links.tsx',
    )
    const interfaces = deriveApiInterfacesFromTree(analyses)
    const every = (address: string) => ['DELETE', 'GET', 'PATCH', 'POST', 'PUT'].map((method) => `${method} ${address}`)
    expect(interfaces.map((entry) => entry.title)).toEqual([
      // an optional catch-all answers at its parent and under it; next-auth
      // dispatches inside the library, so every conventional method reaches it
      ...every('/api/auth'),
      ...every('/api/auth/{...nextauth}'),
      'GET /api/export',
      'HEAD /api/export',
      // no method check: every conventional method reaches it
      ...every('/api/health'),
      // a directory named index is an address like any other; only the file is not
      ...every('/api/index'),
      'GET /api/links',
      'POST /api/links',
      'DELETE /api/links/{id}',
      'GET /api/links/{id}',
      'PUT /api/links/{id}',
      // the same-file helper's HEAD check is not part of the handler
      'POST /api/notes',
      'GET /api/tags',
      'PATCH /api/tags',
      // the `!== 'POST'` guard names the one method served; prisma's `.delete` is not one
      'POST /api/upload/{...path}',
    ])
    expect(interfaces.every((entry) => entry.type === 'api' && !entry.specOnly)).toBe(true)
  })

  it('reads every dispatch shape: a preflight guard, a handler map, a wrapper map, an open else', async () => {
    const analyses = await analyze(
      'pages/api/dispatch/preflight.ts',
      'pages/api/dispatch/preflight-only.ts',
      'pages/api/dispatch/map.ts',
      'pages/api/dispatch/wrapped.ts',
      'pages/api/dispatch/else.ts',
    )
    const methodsAt = (address: string) =>
      analyses
        .flatMap((file) => file.routeRegistrations ?? [])
        .filter((route) => route.path === address)
        .map((route) => route.httpMethod)
        .sort()
    // the OPTIONS check answers the preflight; it does not hide the real method
    expect(methodsAt('/api/dispatch/preflight')).toEqual(['OPTIONS', 'POST'])
    // a preflight alone establishes nothing: every conventional method reaches the body
    expect(methodsAt('/api/dispatch/preflight-only')).toEqual(['DELETE', 'GET', 'PATCH', 'POST', 'PUT'])
    expect(methodsAt('/api/dispatch/map')).toEqual(['DELETE', 'GET'])
    expect(methodsAt('/api/dispatch/wrapped')).toEqual(['POST', 'PUT'])
    // the else serves what the check did not name
    expect(methodsAt('/api/dispatch/else')).toEqual(['DELETE', 'GET', 'PATCH', 'POST', 'PUT'])
  })

  it('names the handler and points at the default export', async () => {
    const [links] = await analyze('pages/api/links/[id].ts')
    const registrations = links.routeRegistrations ?? []
    expect(registrations.map((route) => route.handlerName)).toEqual(['handler', 'handler', 'handler'])
    expect(registrations[0].location.startLine).toBe(19)
  })

  it('reads no route from a helper without a default export, and none from a screen', async () => {
    const analyses = await analyze('pages/api/_lib/respond.ts', 'pages/links.tsx')
    expect(analyses.flatMap((file) => file.routeRegistrations ?? [])).toEqual([])
  })

  it('reads nothing from a pages/api tree with no Next.js app around it', async () => {
    const stray = path.resolve('tests/fixtures/next-pages-api-stray')
    const analysis = await analyzeFile(path.join(stray, 'pages/api/echo.ts'))
    expect(analysis?.routeRegistrations ?? []).toEqual([])
  })
})
