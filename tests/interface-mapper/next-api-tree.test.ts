import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { analyzeFile } from '../../packages/analyzer/src/file-analyzer'
import { collectApiRequestContracts } from '../../packages/interface-mapper/src/api-contracts'
import { deriveApiInterfacesFromTree } from '../../packages/interface-mapper/src/api-tree'
import type { FileAnalysis } from '../../packages/shared/src/index'

// Handler source from spiderhands/expense-tracker at 58899f746bc470cfafb802d1cb27b35893631ad6.
// The real setup returned HTTP 200 for /api/expenses but the tree API catalog was empty.
const root = path.resolve('tests/fixtures/next-expense-app')

describe('Next expense API analyzer → mapper regression', () => {
  it('maps the five source-declared CRUD operations without a live endpoint or OpenAPI document', async () => {
    const analyses = (await Promise.all([
      analyzeFile(path.join(root, 'app/api/expenses/route.ts')),
      analyzeFile(path.join(root, 'app/api/expenses/[id]/route.ts')),
    ])).filter((file): file is FileAnalysis => file !== null)
    const interfaces = deriveApiInterfacesFromTree(analyses)
    expect(interfaces.map((entry) => entry.title)).toEqual([
      'GET /api/expenses', 'POST /api/expenses',
      'DELETE /api/expenses/{id}', 'GET /api/expenses/{id}', 'PUT /api/expenses/{id}',
    ])
    expect(interfaces.every((entry) => entry.type === 'api' && !entry.specOnly)).toBe(true)
    const registrations = analyses.flatMap((file) => file.routeRegistrations ?? [])
    expect(registrations.find((route) => route.httpMethod === 'DELETE')?.requestContract?.produces?.statuses).toEqual([204])
    expect(collectApiRequestContracts(analyses)).toEqual([{
      method: 'DELETE', path: '/api/expenses/{id}', produces: { statuses: [204] },
    }])
    // Custom json/readBody helper behavior is not guessed from names.
    expect(registrations.find((route) => route.httpMethod === 'POST')?.requestContract).toBeUndefined()
    // Canonical source paths and OpenAPI operations converge on the same interfaces.
    const merged = deriveApiInterfacesFromTree(analyses, [{ method: 'get', routePath: '/api/expenses/{id}/' }])
    expect(merged).toEqual(interfaces)
  })
})
