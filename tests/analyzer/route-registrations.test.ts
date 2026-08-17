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

  it('registers inline handlers with an empty name — the route is the surface either way', () => {
    const tree = parse(`
      const router = Router();
      router.get('/health', (_req, res) => { res.json({ ok: true }) });
      router.get('/weather', async (req, res, next) => { res.json(await lookup(req)) });
      router.post('/legacy', function (req, res) { res.sendStatus(410) });
    `)

    const { routes } = extractRouteRegistrations(tree, '/test.ts', 'typescript')

    expect(routes).toMatchObject([
      { httpMethod: 'GET', path: '/health', handlerName: '' },
      { httpMethod: 'GET', path: '/weather', handlerName: '' },
      { httpMethod: 'POST', path: '/legacy', handlerName: '' },
    ])
  })

  it('attributes a wrapped handler to the symbol inside the wrapper', () => {
    const tree = parse(`
      const router = Router();
      router.get('/todos', asyncHandler(getTodos));
      router.get('/tasks', asyncHandler(async (req, res) => { res.json([]) }));
    `)

    const { routes } = extractRouteRegistrations(tree, '/test.ts', 'typescript')

    expect(routes).toMatchObject([
      { httpMethod: 'GET', path: '/todos', handlerName: 'getTodos' },
      { httpMethod: 'GET', path: '/tasks', handlerName: '' },
    ])
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

  it('captures the router mounted behind middleware args', () => {
    // The dashboard-server idiom: `app.use(prefix, middleware, router)`. Express
    // mounts EVERY handler arg at the prefix, so every identifier after the path
    // is a candidate — the middleware ones drop out when a consumer resolves
    // them against the tree and finds no router.
    const tree = parse(`
      const app = express();
      app.use('/api/repos', projectResolver, analysesRouter);
      app.use('/api/repos', requireAuth, validate, guardRouter);
    `)

    const { mounts } = extractRouteRegistrations(tree, '/test.ts', 'typescript')

    expect(mounts).toMatchObject([
      { path: '/api/repos', routerName: 'projectResolver' },
      { path: '/api/repos', routerName: 'analysesRouter' },
      { path: '/api/repos', routerName: 'requireAuth' },
      { path: '/api/repos', routerName: 'validate' },
      { path: '/api/repos', routerName: 'guardRouter' },
    ])
  })

  it('skips non-identifier mount args', () => {
    const tree = parse(`
      const app = express();
      app.use('/api', express.static(dir), apiRouter);
      app.use('/inline', (req, res, next) => next());
    `)

    const { mounts } = extractRouteRegistrations(tree, '/test.ts', 'typescript')

    expect(mounts).toMatchObject([{ path: '/api', routerName: 'apiRouter' }])
  })

  it('includes correct location info', () => {
    const tree = parse(`router.get('/users', getUsers);`)

    const { routes } = extractRouteRegistrations(tree, '/routes.ts', 'typescript')

    expect(routes).toHaveLength(1)
    expect(routes[0].location.filePath).toBe('/routes.ts')
    expect(routes[0].location.startLine).toBe(1)
  })
})

/**
 * The receiver gate. Every case below is drawn from strapi, where an ungated
 * `<anything>.get('<string>', <arg>)` match turned 103 of 107 derived "endpoints"
 * into noise mined out of MSW mocks and config reads.
 */
describe('extractRouteRegistrations — the receiver gate', () => {
  it('ignores MSW mock handlers, glob path or not', () => {
    // packages/core/upload/admin/tests/handlers.ts + admin/tests/server.ts.
    // The second one passes the leading-slash test, so only the receiver
    // separates it from a real registration.
    const tree = parse(`
      import { http, HttpResponse } from 'msw';
      import { setupServer } from 'msw/node';
      export const handlers = [
        http.get('*/a-pdf.pdf', () => HttpResponse.text('pdf')),
        http.get('/admin/roles/1', () => HttpResponse.json({ data: {} })),
        http.post('https://analytics.strapi.io/api/v2/track', () => new HttpResponse(null)),
      ];
      const server = setupServer(...handlers);
    `)

    const { routes } = extractRouteRegistrations(tree, '/admin/tests/server.ts', 'typescript')

    expect(routes).toEqual([])
  })

  it('ignores a config read whose key reads like a dotted path', () => {
    const tree = parse(`
      const idle = strapi.config.get('admin.auth.sessions.idleSessionLifespan', DEFAULT_IDLE);
      const port = config.get('server.port', 1337);
    `)

    const { routes } = extractRouteRegistrations(tree, '/server/src/config.ts', 'typescript')

    expect(routes).toEqual([])
  })

  it('ignores http-client calls and map lookups that share the shape', () => {
    const tree = parse(`
      import axios from 'axios';
      const cache = new Map();
      await axios.get('/api/users', { params: { page: 1 } });
      await client.post('/v1/messages', body);
      cache.get('/api/users', fallback);
    `)

    const { routes } = extractRouteRegistrations(tree, '/src/client.ts', 'typescript')

    expect(routes).toEqual([])
  })

  it('keeps routes on a receiver bound to a framework constructor', () => {
    // `api` is not a conventional router name — only the binding says it is one.
    const tree = parse(`
      import express from 'express';
      const api = express();
      const v2 = express.Router();
      api.get('/users', listUsers);
      v2.post('/users', createUser);
    `)

    const { routes } = extractRouteRegistrations(tree, '/src/api.ts', 'typescript')

    expect(routes).toMatchObject([
      { httpMethod: 'GET', path: '/users', handlerName: 'listUsers' },
      { httpMethod: 'POST', path: '/users', handlerName: 'createUser' },
    ])
  })

  it('keeps routes on non-Express framework instances', () => {
    const tree = parse(`
      import { Hono } from 'hono';
      import Fastify from 'fastify';
      const edge = new Hono();
      const svc = Fastify();
      edge.get('/edge/ping', pong);
      svc.delete('/jobs/:id', cancelJob);
    `)

    const { routes } = extractRouteRegistrations(tree, '/src/edge.ts', 'typescript')

    expect(routes).toMatchObject([
      { httpMethod: 'GET', path: '/edge/ping', handlerName: 'pong' },
      { httpMethod: 'DELETE', path: '/jobs/:id', handlerName: 'cancelJob' },
    ])
  })

  it('keeps routes on a receiver the file also treats as a server', () => {
    // No binding and no conventional name — `.listen()` in the same file is
    // what identifies it.
    const tree = parse(`
      import { instance } from './bootstrap.js';
      instance.use(json());
      instance.listen(3000);
      instance.get('/status', getStatus);
    `)

    const { routes } = extractRouteRegistrations(tree, '/src/boot.ts', 'typescript')

    expect(routes).toMatchObject([{ httpMethod: 'GET', path: '/status', handlerName: 'getStatus' }])
  })

  it('reads through a member-expression receiver to its last segment', () => {
    // `this.app.get(...)` is a route; `strapi.config.get(...)` is not, and both
    // arrive as member_expression receivers.
    const tree = parse(`
      class Server {
        register() {
          this.app.get('/health', getHealth);
          this.deps.registry.get('/health', getHealth);
        }
      }
    `)

    const { routes } = extractRouteRegistrations(tree, '/src/server.ts', 'typescript')

    expect(routes).toMatchObject([{ httpMethod: 'GET', path: '/health', handlerName: 'getHealth' }])
  })

  it('keeps a router handed in as a parameter', () => {
    const tree = parse(`
      export function registerTodoRoutes(router) {
        router.get('/todos', listTodos);
      }
      export function registerHealth(app) {
        app.get('/healthz', ok);
      }
    `)

    const { routes } = extractRouteRegistrations(tree, '/src/register.ts', 'typescript')

    expect(routes).toMatchObject([
      { httpMethod: 'GET', path: '/todos', handlerName: 'listTodos' },
      { httpMethod: 'GET', path: '/healthz', handlerName: 'ok' },
    ])
  })

  it('keeps the Express catch-all but rejects any other non-slash path', () => {
    const tree = parse(`
      const app = express();
      app.get('*', spaFallback);
      app.get('users', listUsers);
      app.get('*/thumbnail.png', thumb);
    `)

    const { routes } = extractRouteRegistrations(tree, '/src/app.ts', 'typescript')

    expect(routes).toMatchObject([{ httpMethod: 'GET', path: '*', handlerName: 'spaFallback' }])
  })

  it('keeps every registration in a chained builder, not just the innermost', () => {
    // `new Hono().get(…).post(…).get(…)` — the receiver of every call but the
    // innermost is ANOTHER call, so router-likeness has to be read from the head
    // of the chain. Costs 36 real registrations in documenso when it is not.
    const tree = parse(`
      import { Hono } from 'hono';
      export const app = new Hono().get('/a', h1).post('/b', h2).get('/c', h3);
    `)

    const { routes } = extractRouteRegistrations(tree, '/src/hono.ts', 'typescript')

    // Traversal is outside-in, so the last link in the chain is seen first.
    expect(routes).toMatchObject([
      { httpMethod: 'GET', path: '/c', handlerName: 'h3' },
      { httpMethod: 'POST', path: '/b', handlerName: 'h2' },
      { httpMethod: 'GET', path: '/a', handlerName: 'h1' },
    ])
  })

  it('keeps a chain headed by a constructor call rather than a `new`', () => {
    const tree = parse(`
      import { Router } from 'itty-router';
      export const router = express.Router().get('/x', hx).post('/y', hy);
      export const itty = Router().get('/z', hz);
    `)

    const { routes } = extractRouteRegistrations(tree, '/src/chain.ts', 'typescript')

    expect(routes).toMatchObject([
      { httpMethod: 'POST', path: '/y', handlerName: 'hy' },
      { httpMethod: 'GET', path: '/x', handlerName: 'hx' },
      { httpMethod: 'GET', path: '/z', handlerName: 'hz' },
    ])
  })

  it('names a chained builder bound to a variable as a router for later calls', () => {
    // `authRoute` is not a conventional router name, so only the chain head says
    // it is one — the binding has to be read through the chain as well.
    const tree = parse(`
      import { Hono } from 'hono';
      const authRoute = new Hono().basePath('/auth');
      authRoute.post('/login', login);
    `)

    const { routes } = extractRouteRegistrations(tree, '/src/auth.ts', 'typescript')

    expect(routes).toMatchObject([
      { httpMethod: 'POST', path: '/login', handlerName: 'login' },
    ])
  })

  it('rejects a chained call whose head is not a router — `axios.create().get(…)`', () => {
    // The nearest miss to the chained-builder case above: same shape, but the
    // head resolves to `axios`, which earns nothing. The second call uses a
    // handler-shaped last argument so that ONLY the receiver gate can reject it.
    const tree = parse(`
      import axios from 'axios';
      await axios.create().get('/api/users', { params: { page: 1 } });
      await axios.create({ baseURL }).get('/api/users', (res) => res.data);
      await client.create().post('/v1/messages', body);
    `)

    const { routes } = extractRouteRegistrations(tree, '/src/client.ts', 'typescript')

    expect(routes).toEqual([])
  })

  it('rejects a chain headed by a plain call, MSW `.use` included', () => {
    const tree = parse(`
      import { http } from 'msw';
      import { setupServer } from 'msw/node';
      const srv = setupServer();
      srv.use(http.get('/admin/roles/1', () => json({})));
      makeClient().get('/api/users', onUsers);
    `)

    const { routes } = extractRouteRegistrations(tree, '/tests/server.ts', 'typescript')

    expect(routes).toEqual([])
  })

  it('gates mounts on the receiver too, and `.use` cannot vouch for itself', () => {
    // `i18n.use(...)` is the very call being gated, so its own presence must not
    // be what admits it — otherwise every `.use` in the repo is a router mount.
    const tree = parse(`
      const app = express();
      app.use('/api', apiRouter);
      i18n.use('/api', someInitializer);
    `)

    const { mounts } = extractRouteRegistrations(tree, '/src/app.ts', 'typescript')

    expect(mounts).toMatchObject([{ path: '/api', routerName: 'apiRouter' }])
  })
})

describe('extractRouteRegistrations — backtick paths', () => {
  it('reads a backtick path with no interpolation as the string it is', () => {
    const tree = parse(`
      const app = express();
      app.get(\`/api/v2/openapi.json\`, serveSpec);
      app.get('/api/v2-beta/openapi.json', serveBetaSpec);
    `)

    const { routes } = extractRouteRegistrations(tree, '/server/router.ts', 'typescript')

    expect(routes).toMatchObject([
      { httpMethod: 'GET', path: '/api/v2/openapi.json', handlerName: 'serveSpec' },
      { httpMethod: 'GET', path: '/api/v2-beta/openapi.json', handlerName: 'serveBetaSpec' },
    ])
  })

  it('skips an interpolated backtick path rather than half-guessing it', () => {
    const tree = parse(`
      const app = express();
      app.get(\`/users/\${id}\`, getUser);
      app.get(\`\${PREFIX}/health\`, getHealth);
      app.use(\`/api/\${version}\`, apiRouter);
    `)

    const { routes, mounts } = extractRouteRegistrations(tree, '/server/router.ts', 'typescript')

    expect(routes).toEqual([])
    expect(mounts).toEqual([])
  })

  it('mounts a backtick prefix with no interpolation', () => {
    const tree = parse(`
      const app = express();
      app.use(\`/api/v1\`, apiRouter);
    `)

    const { mounts } = extractRouteRegistrations(tree, '/server/router.ts', 'typescript')

    expect(mounts).toMatchObject([{ path: '/api/v1', routerName: 'apiRouter' }])
  })
})
