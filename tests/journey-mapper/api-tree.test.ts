/**
 * The api derivation: analyzer route registrations (mount prefixes composed) ∪
 * OpenAPI operations → journeys. The fixtures run real source through the real
 * analyzer, so this covers the extractor → mapper seam rather than hand-written
 * artifact literals.
 */
import { describe, it, expect } from 'vitest'
import { analyzeFileContent } from '../../packages/analyzer/src/file-analyzer'
import { deriveApiJourneysFromTree, type ApiSpecOperation } from '../../packages/journey-mapper/src/api-tree'
import type { FileAnalysis } from '../../packages/shared/src/index'

const APP_SOURCE = `
  import express from 'express'
  import { todosRouter } from './routes/todos.js'
  import { getHealth } from './handlers/health.js'

  const app = express()
  app.get('/health', getHealth)
  app.use('/api/todos', todosRouter)
  app.listen(3000)
`

const TODOS_ROUTER_SOURCE = `
  import { Router } from 'express'
  import { listTodos, createTodo, getTodo, deleteTodo } from '../handlers/todos.js'

  export const todosRouter = Router()
  todosRouter.get('/', listTodos)
  todosRouter.post('/', createTodo)
  todosRouter.get('/:id', getTodo)
  todosRouter.delete('/:id', deleteTodo)
`

function analyze(filePath: string, source: string): FileAnalysis {
  return analyzeFileContent(filePath, source, 'typescript')
}

const TREE = [analyze('src/app.ts', APP_SOURCE), analyze('src/routes/todos.ts', TODOS_ROUTER_SOURCE)]

describe('deriveApiJourneysFromTree — route registrations', () => {
  const journeys = deriveApiJourneysFromTree(TREE)

  it('emits one journey per operation, mount prefixes composed, ordered by path then method', () => {
    expect(journeys.map((j) => j.id)).toEqual([
      'api/get-api-todos',
      'api/post-api-todos',
      'api/delete-api-todos-id',
      'api/get-api-todos-id',
      'api/get-health',
    ])
  })

  it('roots each journey at its operation with a single request step, params canonical', () => {
    const getTodo = journeys.find((j) => j.id === 'api/get-api-todos-id')
    expect(getTodo).toMatchObject({
      type: 'api',
      title: 'GET /api/todos/{id}',
      entry: { method: 'GET', path: '/api/todos/{id}' },
      steps: [{ kind: 'request', method: 'GET', path: '/api/todos/{id}', label: 'getTodo' }],
    })
    expect(getTodo?.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(getTodo?.specOnly).toBeUndefined()
  })

  it('maps routes with inline handlers — no symbol needed, no label invented', () => {
    // The common Express style (the speced-api live-miss, 2026-07-27): every
    // handler is an inline arrow, so nothing has a name to attribute.
    const inline = analyze(
      'src/app.ts',
      `
      import express from 'express'
      const app = express()
      app.get('/healthz', (_req, res) => { res.json({ ok: true }) })
      app.get('/v1/weather', async (req, res, next) => { res.json(await lookup(req)) })
      app.listen(8080)
    `,
    )
    const journeys = deriveApiJourneysFromTree([inline])
    expect(journeys.map((j) => j.title)).toEqual(['GET /healthz', 'GET /v1/weather'])
    expect(journeys.every((j) => j.steps[0].label === undefined)).toBe(true)
  })

  it('maps nothing for a repo with no api surface', () => {
    const service = analyze(
      'src/report.ts',
      `export function buildReport(rows: string[]): string { return rows.join('\\n') }`,
    )
    expect(deriveApiJourneysFromTree([service])).toEqual([])
  })
})

describe('deriveApiJourneysFromTree — the OpenAPI union', () => {
  const SPEC_OPS: ApiSpecOperation[] = [
    { method: 'get', routePath: '/health', operationId: 'getHealth' },
    { method: 'get', routePath: '/api/todos/{id}', operationId: 'getTodoById' },
    { method: 'patch', routePath: '/api/todos/{id}', operationId: 'updateTodo' },
  ]

  it('dedupes operations both sides declare and marks code-less ones specOnly', () => {
    const journeys = deriveApiJourneysFromTree(TREE, SPEC_OPS)
    // Declared on both sides: ONE journey, no specOnly, code-side label kept.
    const health = journeys.filter((j) => j.title === 'GET /health')
    expect(health).toHaveLength(1)
    expect(health[0].specOnly).toBeUndefined()
    expect(health[0].steps[0]).toMatchObject({ label: 'getHealth' })
    // Declared only in the doc: the documented-but-unimplemented cross-check.
    const patch = journeys.find((j) => j.title === 'PATCH /api/todos/{id}')
    expect(patch).toMatchObject({
      specOnly: true,
      entry: { method: 'PATCH', path: '/api/todos/{id}' },
    })
  })

  it('never marks specOnly when the tree yielded no route registrations at all', () => {
    // A framework-free server (guard-fixture-api's shape): the extractor sees no
    // routes, so "documented but not routed" cannot be asserted about anything.
    const journeys = deriveApiJourneysFromTree([], SPEC_OPS)
    expect(journeys).toHaveLength(3)
    expect(journeys.every((j) => j.specOnly === undefined)).toBe(true)
    expect(journeys.map((j) => j.id)).toEqual([
      'api/get-api-todos-id',
      'api/patch-api-todos-id',
      'api/get-health',
    ])
  })

  it('uses the operationId as the label when the code side has none', () => {
    const journeys = deriveApiJourneysFromTree([], SPEC_OPS)
    expect(journeys.find((j) => j.id === 'api/patch-api-todos-id')?.steps[0]).toMatchObject({
      label: 'updateTodo',
    })
  })
})

describe('api journey fingerprints — operation identity only', () => {
  it('is identical whichever side declared the operation', () => {
    const fromCode = deriveApiJourneysFromTree(TREE).find((j) => j.title === 'GET /api/todos/{id}')
    const fromSpec = deriveApiJourneysFromTree(
      [],
      [{ method: 'get', routePath: '/api/todos/{id}' }],
    )[0]
    expect(fromSpec.fingerprint).toBe(fromCode?.fingerprint)
    expect(fromSpec.id).toBe(fromCode?.id)
  })

  it('survives a file move, a handler rename, and gaining an OpenAPI doc', () => {
    const original = deriveApiJourneysFromTree(TREE)
    const refactored = deriveApiJourneysFromTree(
      [
        analyze('src/server/main.ts', APP_SOURCE.replace('./routes/todos.js', '../routes/todos.js')),
        analyze('src/routes/todos.ts', TODOS_ROUTER_SOURCE.replace(/getTodo\b/g, 'fetchTodoById')),
      ],
      [{ method: 'get', routePath: '/api/todos/{id}', operationId: 'getTodoById' }],
    )
    expect(refactored.map((j) => j.fingerprint)).toEqual(original.map((j) => j.fingerprint))
  })

  it('moves when the operation itself moves', () => {
    const moved = deriveApiJourneysFromTree([
      analyze('src/app.ts', APP_SOURCE.replace(`'/api/todos'`, `'/v2/todos'`)),
      analyze('src/routes/todos.ts', TODOS_ROUTER_SOURCE),
    ])
    const before = deriveApiJourneysFromTree(TREE)
    expect(moved.find((j) => j.title.includes('/v2/todos/{id}'))).toBeDefined()
    expect(moved.map((j) => j.fingerprint)).not.toEqual(before.map((j) => j.fingerprint))
  })
})
