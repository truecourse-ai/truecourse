import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { analyzeFile } from '../../packages/source-facts/src/file-analyzer'
import { deriveApiInterfacesFromTree } from '../../packages/interface-mapper/src/api-tree'
import type { FileAnalysis } from '../../packages/shared/src/index'

// A pages-router api surface, the shape linkwarden's 56 handlers take: one
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
    expect(interfaces.map((entry) => entry.title)).toEqual([
      // an optional catch-all answers at its parent and under it
      'GET /api/auth',
      'GET /api/auth/{...nextauth}',
      'GET /api/export',
      'HEAD /api/export',
      // no discriminator: every method reaches it, GET stands for the operation
      'GET /api/health',
      // a directory named index is an address like any other; only the file is not
      'GET /api/index',
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
