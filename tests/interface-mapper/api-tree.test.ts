/**
 * The api derivation: analyzer route registrations (mount prefixes composed) ∪
 * OpenAPI operations → interfaces. The fixtures run real source through the real
 * analyzer, so this covers the extractor → mapper seam rather than hand-written
 * artifact literals.
 */
import { describe, it, expect } from 'vitest'
import { analyzeFileContent } from '../../packages/analyzer/src/file-analyzer'
import {
  buildMountPrefixes,
  deriveApiInterfacesFromTree,
  type ApiSpecOperation,
} from '../../packages/interface-mapper/src/api-tree'
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

describe('deriveApiInterfacesFromTree — route registrations', () => {
  const interfaces = deriveApiInterfacesFromTree(TREE)

  it('emits one interface per operation, mount prefixes composed, ordered by path then method', () => {
    expect(interfaces.map((j) => j.id)).toEqual([
      'api/get-api-todos',
      'api/post-api-todos',
      'api/delete-api-todos-id',
      'api/get-api-todos-id',
      'api/get-health',
    ])
  })

  it('roots each interface at its operation with a single request step, params canonical', () => {
    const getTodo = interfaces.find((j) => j.id === 'api/get-api-todos-id')
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
    const interfaces = deriveApiInterfacesFromTree([inline])
    expect(interfaces.map((j) => j.title)).toEqual(['GET /healthz', 'GET /v1/weather'])
    expect(interfaces.every((j) => j.steps[0].label === undefined)).toBe(true)
  })

  it('maps nothing for a repo with no api surface', () => {
    const service = analyze(
      'src/report.ts',
      `export function buildReport(rows: string[]): string { return rows.join('\\n') }`,
    )
    expect(deriveApiInterfacesFromTree([service])).toEqual([])
  })
})

/**
 * The dashboard-server layout, which is also the mainstream Express one: routers
 * are declared + registered in per-module files, default-exported, and mounted in
 * `app.ts` — often BEHIND middleware args (`app.use(prefix, resolver, router)`)
 * and sometimes one router deep (`adminRouter.use('/users', usersRouter)`).
 */
const MULTI_FILE_TREE = [
  analyze(
    'src/app.ts',
    `
    import express from 'express'
    import { projectResolver } from './middleware/project.js'
    import reposRouter from './routes/repos.js'
    import analysesRouter from './routes/analyses.js'
    import adminRouter from './routes/admin/index.js'
    import { getHealth } from './handlers/health.js'

    const app = express()
    app.use('/api', authGate)
    app.use('/api/repos', reposRouter)
    app.use('/api/repos', projectResolver, analysesRouter)
    app.use('/api/admin', adminRouter)
    app.get('/api/health', getHealth)
  `,
  ),
  analyze(
    'src/middleware/project.ts',
    `export function projectResolver(req, res, next) { next() }`,
  ),
  analyze(
    'src/routes/repos.ts',
    `
    import { Router } from 'express'
    const router = Router()
    router.post('/', createRepo)
    router.get('/:id', getRepo)
    export default router
  `,
  ),
  analyze(
    'src/routes/analyses.ts',
    `
    import { Router } from 'express'
    const router = Router()
    router.get('/:id/analyses', listAnalyses)
    export default router
  `,
  ),
  analyze(
    'src/routes/admin/index.ts',
    `
    import { Router } from 'express'
    import usersRouter from './users.js'
    const adminRouter = Router()
    adminRouter.use('/users', usersRouter)
    export default adminRouter
  `,
  ),
  analyze(
    'src/routes/admin/users.ts',
    `
    import { Router } from 'express'
    const router = Router()
    router.get('/', listUsers)
    router.delete('/:userId', removeUser)
    export default router
  `,
  ),
]

describe('deriveApiInterfacesFromTree — routers mounted from another file', () => {
  it('composes the mount prefix onto a router mounted behind middleware args', () => {
    const paths = deriveApiInterfacesFromTree(MULTI_FILE_TREE).map((j) => j.title)
    expect(paths).toContain('GET /api/repos/{id}/analyses')
    expect(paths).not.toContain('GET /{id}/analyses')
  })

  it('composes a two-level mount chain', () => {
    const paths = deriveApiInterfacesFromTree(MULTI_FILE_TREE).map((j) => j.title)
    expect(paths).toContain('GET /api/admin/users')
    expect(paths).toContain('DELETE /api/admin/users/{userId}')
  })

  it('leaves nothing bare across the whole layout', () => {
    expect(deriveApiInterfacesFromTree(MULTI_FILE_TREE).map((j) => j.title).sort()).toEqual([
      'DELETE /api/admin/users/{userId}',
      'GET /api/admin/users',
      'GET /api/health',
      'GET /api/repos/{id}',
      'GET /api/repos/{id}/analyses',
      'POST /api/repos',
    ])
  })

  it('never hands a mount prefix to a middleware module', () => {
    // `app.use('/api/repos', projectResolver, analysesRouter)` names two things;
    // only the one that turns out to be a router may claim the prefix.
    const prefixes = buildMountPrefixes(MULTI_FILE_TREE)
    expect(prefixes.get('src/middleware/project.ts')).toBeUndefined()
    expect(prefixes.get('src/routes/analyses.ts')).toBe('/api/repos')
    expect(prefixes.get('src/routes/admin/users.ts')).toBe('/api/admin/users')
  })
})

describe('deriveApiInterfacesFromTree — the OpenAPI union', () => {
  const SPEC_OPS: ApiSpecOperation[] = [
    { method: 'get', routePath: '/health', operationId: 'getHealth' },
    { method: 'get', routePath: '/api/todos/{id}', operationId: 'getTodoById' },
    { method: 'patch', routePath: '/api/todos/{id}', operationId: 'updateTodo' },
  ]

  it('dedupes operations both sides declare and marks code-less ones specOnly', () => {
    const interfaces = deriveApiInterfacesFromTree(TREE, SPEC_OPS)
    // Declared on both sides: ONE interface, no specOnly, code-side label kept.
    const health = interfaces.filter((j) => j.title === 'GET /health')
    expect(health).toHaveLength(1)
    expect(health[0].specOnly).toBeUndefined()
    expect(health[0].steps[0]).toMatchObject({ label: 'getHealth' })
    // Declared only in the doc: the documented-but-unimplemented cross-check.
    const patch = interfaces.find((j) => j.title === 'PATCH /api/todos/{id}')
    expect(patch).toMatchObject({
      specOnly: true,
      entry: { method: 'PATCH', path: '/api/todos/{id}' },
    })
  })

  it('never marks specOnly when the tree yielded no route registrations at all', () => {
    // A framework-free server (guard-fixture-api's shape): the extractor sees no
    // routes, so "documented but not routed" cannot be asserted about anything.
    const interfaces = deriveApiInterfacesFromTree([], SPEC_OPS)
    expect(interfaces).toHaveLength(3)
    expect(interfaces.every((j) => j.specOnly === undefined)).toBe(true)
    expect(interfaces.map((j) => j.id)).toEqual([
      'api/get-api-todos-id',
      'api/patch-api-todos-id',
      'api/get-health',
    ])
  })

  it('uses the operationId as the label when the code side has none', () => {
    const interfaces = deriveApiInterfacesFromTree([], SPEC_OPS)
    expect(interfaces.find((j) => j.id === 'api/patch-api-todos-id')?.steps[0]).toMatchObject({
      label: 'updateTodo',
    })
  })
})

describe('api interface fingerprints — operation identity only', () => {
  it('is identical whichever side declared the operation', () => {
    const fromCode = deriveApiInterfacesFromTree(TREE).find((j) => j.title === 'GET /api/todos/{id}')
    const fromSpec = deriveApiInterfacesFromTree(
      [],
      [{ method: 'get', routePath: '/api/todos/{id}' }],
    )[0]
    expect(fromSpec.fingerprint).toBe(fromCode?.fingerprint)
    expect(fromSpec.id).toBe(fromCode?.id)
  })

  it('survives a file move, a handler rename, and gaining an OpenAPI doc', () => {
    const original = deriveApiInterfacesFromTree(TREE)
    const refactored = deriveApiInterfacesFromTree(
      [
        analyze('src/server/main.ts', APP_SOURCE.replace('./routes/todos.js', '../routes/todos.js')),
        analyze('src/routes/todos.ts', TODOS_ROUTER_SOURCE.replace(/getTodo\b/g, 'fetchTodoById')),
      ],
      [{ method: 'get', routePath: '/api/todos/{id}', operationId: 'getTodoById' }],
    )
    expect(refactored.map((j) => j.fingerprint)).toEqual(original.map((j) => j.fingerprint))
  })

  it('moves when the operation itself moves', () => {
    const moved = deriveApiInterfacesFromTree([
      analyze('src/app.ts', APP_SOURCE.replace(`'/api/todos'`, `'/v2/todos'`)),
      analyze('src/routes/todos.ts', TODOS_ROUTER_SOURCE),
    ])
    const before = deriveApiInterfacesFromTree(TREE)
    expect(moved.find((j) => j.title.includes('/v2/todos/{id}'))).toBeDefined()
    expect(moved.map((j) => j.fingerprint)).not.toEqual(before.map((j) => j.fingerprint))
  })
})
