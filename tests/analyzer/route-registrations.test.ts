import { describe, it, expect } from 'vitest'
import { extractRouteRegistrations } from '../../packages/analyzer/src/extractors/route-registrations'
import { parseCode } from '../../packages/analyzer/src/parser'

function parse(code: string) {
  return parseCode(code, 'typescript')
}

describe('extractRouteRegistrations', () => {
  it('extracts basic route registrations', () => {
    const tree = parse(`
      import { Router } from 'express';
      const router = Router();
      router.get('/', getUsers);
      router.get('/:id', getUserById);
      router.post('/', createUser);
      router.delete('/:id', deleteUser);
    `)

    const { routes, mounts } = extractRouteRegistrations(tree, '/test.ts', 'typescript')

    expect(routes).toHaveLength(4)
    expect(routes[0]).toMatchObject({ httpMethod: 'GET', path: '/', handlerName: 'getUsers' })
    expect(routes[1]).toMatchObject({ httpMethod: 'GET', path: '/:id', handlerName: 'getUserById' })
    expect(routes[2]).toMatchObject({ httpMethod: 'POST', path: '/', handlerName: 'createUser' })
    expect(routes[3]).toMatchObject({ httpMethod: 'DELETE', path: '/:id', handlerName: 'deleteUser' })
    expect(mounts).toHaveLength(0)
  })

  it('extracts class method handlers from member expressions', () => {
    const tree = parse(`
      const router = Router();
      const controller = new UserController();
      router.get('/', controller.getAll);
      router.get('/:id', controller.getById);
    `)

    const { routes } = extractRouteRegistrations(tree, '/test.ts', 'typescript')

    expect(routes).toHaveLength(2)
    expect(routes[0]).toMatchObject({ httpMethod: 'GET', path: '/', handlerName: 'getAll' })
    expect(routes[1]).toMatchObject({ httpMethod: 'GET', path: '/:id', handlerName: 'getById' })
  })

  it('skips middleware and takes last argument as handler', () => {
    const tree = parse(`
      const router = Router();
      router.get('/protected', authMiddleware, validateInput, getResource);
    `)

    const { routes } = extractRouteRegistrations(tree, '/test.ts', 'typescript')

    expect(routes).toHaveLength(1)
    expect(routes[0]).toMatchObject({ httpMethod: 'GET', path: '/protected', handlerName: 'getResource' })
  })

  it('extracts app.use router mounts', () => {
    const tree = parse(`
      const app = express();
      app.use('/api/users', userRouter);
      app.use('/api/health', healthRouter);
    `)

    const { routes, mounts } = extractRouteRegistrations(tree, '/test.ts', 'typescript')

    expect(routes).toHaveLength(0)
    expect(mounts).toHaveLength(2)
    expect(mounts[0]).toMatchObject({ path: '/api/users', routerName: 'userRouter' })
    expect(mounts[1]).toMatchObject({ path: '/api/health', routerName: 'healthRouter' })
  })

  it('skips inline arrow function handlers', () => {
    const tree = parse(`
      const router = Router();
      router.get('/health', (_req, res) => { res.json({ ok: true }) });
    `)

    const { routes } = extractRouteRegistrations(tree, '/test.ts', 'typescript')

    // Arrow function handler has no extractable name
    expect(routes).toHaveLength(0)
  })

  it('handles all HTTP methods', () => {
    const tree = parse(`
      const router = Router();
      router.get('/a', h1);
      router.post('/b', h2);
      router.put('/c', h3);
      router.delete('/d', h4);
      router.patch('/e', h5);
      router.all('/f', h6);
    `)

    const { routes } = extractRouteRegistrations(tree, '/test.ts', 'typescript')

    expect(routes).toHaveLength(6)
    expect(routes.map((r) => r.httpMethod)).toEqual(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL'])
  })

  it('skips app.use calls with non-string first arg (middleware)', () => {
    const tree = parse(`
      const app = express();
      app.use(express.json());
      app.use(cors());
      app.use('/api', apiRouter);
    `)

    const { mounts } = extractRouteRegistrations(tree, '/test.ts', 'typescript')

    // Only the string-path mount should be captured
    expect(mounts).toHaveLength(1)
    expect(mounts[0]).toMatchObject({ path: '/api', routerName: 'apiRouter' })
  })

  it('includes correct location info', () => {
    const tree = parse(`router.get('/users', getUsers);`)

    const { routes } = extractRouteRegistrations(tree, '/routes.ts', 'typescript')

    expect(routes).toHaveLength(1)
    expect(routes[0].location.filePath).toBe('/routes.ts')
    expect(routes[0].location.startLine).toBe(1)
  })
})
