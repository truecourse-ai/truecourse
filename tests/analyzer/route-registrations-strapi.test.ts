import { describe, it, expect } from 'vitest'
import { extractRouteRegistrations } from '../../packages/analyzer/src/extractors/route-registrations'
import { parseCode } from '../../packages/analyzer/src/parser'

function extract(code: string, filePath: string, language: 'typescript' | 'javascript' = 'typescript') {
  return extractRouteRegistrations(parseCode(code, language), filePath, language)
}

describe('Strapi declarative route tables', () => {
  it('serves a plugin admin router under the plugin name', () => {
    // packages/core/upload/server/src/routes/admin.ts, trimmed.
    const { routes } = extract(
      `
      export const routes = {
        type: 'admin',
        routes: [
          {
            method: 'GET',
            path: '/settings',
            handler: 'admin-settings.getSettings',
            config: { policies: ['admin::isAuthenticatedAdmin'] },
          },
          { method: 'POST', path: '/', handler: 'admin-upload.upload' },
        ],
      }
    `,
      'packages/core/upload/server/src/routes/admin.ts',
    )

    expect(routes).toEqual([
      expect.objectContaining({
        httpMethod: 'GET',
        path: '/upload/settings',
        handlerName: 'admin-settings.getSettings',
      }),
      expect.objectContaining({ httpMethod: 'POST', path: '/upload', handlerName: 'admin-upload.upload' }),
    ])
  })

  it('puts a content-api router behind the global /api prefix', () => {
    const { routes } = extract(
      `
      export default {
        type: 'content-api',
        routes: [{ method: 'GET', path: '/files', handler: 'content-api.find' }],
      }
    `,
      'packages/core/upload/server/src/routes/content-api.ts',
    )

    expect(routes.map((r) => r.path)).toEqual(['/api/upload/files'])
  })

  it('serves the admin package at /admin, ee routes included', () => {
    const { routes } = extract(
      `
      export default {
        type: 'admin',
        routes: [{ method: 'GET', path: '/providers/isSSOLocked', handler: 'authentication.isSSOLocked' }],
      }
    `,
      'packages/core/admin/ee/server/src/routes/sso.ts',
    )

    expect(routes.map((r) => r.path)).toEqual(['/admin/providers/isSSOLocked'])
  })

  it('drops the router prefix for a route that declares its own config.prefix', () => {
    // `config.prefix` moves the route onto the parent API router, so only the
    // api-level prefix survives — `/api/auth/local`, not
    // `/api/users-permissions/auth/local`.
    const { routes } = extract(
      `
      module.exports = {
        type: 'content-api',
        routes: [
          { method: 'POST', path: '/auth/local', handler: 'auth.callback', config: { prefix: '' } },
          { method: 'GET', path: '/roles', handler: 'role.find' },
        ],
      }
    `,
      'packages/plugins/users-permissions/server/src/routes/content-api/index.js',
      'javascript',
    )

    expect(routes.map((r) => r.path)).toEqual(['/api/auth/local', '/api/users-permissions/roles'])
  })

  it('mounts a route array the index composes, rather than guessing its prefix', () => {
    // The route module itself declares no type, so it registers bare paths…
    const module = extract(
      `
      export default [
        { method: 'POST', path: '/admin-tokens', handler: 'admin-token.create' },
        { method: 'GET', path: '/admin-tokens/:id', handler: 'admin-token.get' },
      ]
    `,
      'packages/core/admin/server/src/routes/admin-tokens.ts',
    )
    expect(module.routes.map((r) => r.path)).toEqual(['/admin-tokens', '/admin-tokens/:id'])
    expect(module.mounts).toEqual([])

    // …and the index that spreads it says where they are served.
    const index = extract(
      `
      import adminTokens from './admin-tokens';
      import users from './users';
      const routes = {
        admin: { type: 'admin', routes: [...adminTokens, ...users, ...aiRoutes.routes] },
      };
      export default routes;
    `,
      'packages/core/admin/server/src/routes/index.ts',
    )
    expect(index.routes).toEqual([])
    expect(index.mounts).toEqual([
      expect.objectContaining({ path: '/admin', routerName: 'adminTokens' }),
      expect.objectContaining({ path: '/admin', routerName: 'users' }),
    ])
  })

  it('takes the router type from a routes/<type>/ directory when the file names none', () => {
    // users-permissions splits its table across routes/admin/*.js; the index that
    // types them is CommonJS, which the import reader does not follow, so the
    // directory is the only thing left that says where these are served.
    const { routes } = extract(
      `
      module.exports = [
        { method: 'GET', path: '/advanced', handler: 'settings.getAdvancedSettings' },
      ]
    `,
      'packages/plugins/users-permissions/server/src/routes/admin/settings.js',
      'javascript',
    )

    expect(routes.map((r) => r.path)).toEqual(['/users-permissions/advanced'])
  })

  it('does not read routes/content-api.ts as a content-api router', () => {
    // The admin package's `content-api.ts` holds the ADMIN routes about the
    // content api — `/admin/content-api/routes`, not `/api/...`. Only the
    // directory form carries a type; the file form waits for its index.
    const { routes } = extract(
      `
      export default [{ method: 'GET', path: '/content-api/routes', handler: 'content-api.getRoutes' }]
    `,
      'packages/core/admin/server/src/routes/content-api.ts',
    )

    expect(routes.map((r) => r.path)).toEqual(['/content-api/routes'])
  })

  it('reads a bare array exported by a routes index as the plugin router itself', () => {
    // Strapi wraps a plugin's bare route array as { type: 'admin', prefix: '/<plugin>' }.
    const { routes } = extract(
      `
      export default [
        { method: 'GET', path: '/', handler: 'documentation.index', config: { auth: false } },
        { method: 'GET', path: '/login', handler: 'documentation.loginView' },
      ]
    `,
      'packages/plugins/documentation/server/src/routes/index.ts',
    )

    expect(routes.map((r) => r.path)).toEqual(['/documentation', '/documentation/login'])
  })

  it('reads the routes a content-api factory builds in its callback', () => {
    const { routes } = extract(
      `
      const createRoutes = createContentApiRoutesFactory(() => {
        return [
          { method: 'POST', path: '/', handler: 'content-api.upload' },
          { method: 'GET', path: '/files/:id', handler: 'content-api.findOne' },
        ];
      });
      export default createRoutes;
    `,
      'packages/core/upload/server/src/routes/content-api.ts',
    )

    expect(routes.map((r) => r.path)).toEqual(['/api/upload', '/api/upload/files/:id'])
  })

  it('leaves a route array built inside a function alone until something names it', () => {
    // `(strapi) => [...]` is a factory whose caller decides the address; emitting
    // bare paths here would strand routes nothing can mount.
    const { routes } = extract(
      `
      module.exports = (strapi) => [
        { method: 'POST', path: '/auth/local', handler: 'auth.callback', config: { prefix: '' } },
      ]
    `,
      'packages/plugins/users-permissions/server/src/routes/content-api/auth.js',
      'javascript',
    )

    expect(routes).toEqual([])
  })

  it('ignores route tables outside a server route module', () => {
    const code = `
      export default {
        type: 'admin',
        routes: [{ method: 'GET', path: '/settings', handler: 'x.y' }],
      }
    `
    // Frontend router config, and a repo with no strapi layout at all.
    expect(extract(code, 'packages/core/review-workflows/admin/src/routes/index.ts').routes).toEqual([])
    expect(extract(code, 'src/lib/table.ts').routes).toEqual([])
  })

  it('does not mistake a plain object for a route', () => {
    const { routes } = extract(
      `
      const info = { pluginName: 'content-manager', type: 'admin' };
      const menu = { method: 'GET', label: 'Settings' };
      export default { type: 'admin', routes: [{ method: 'GET', path: '/x', handler: 'a.b' }] };
    `,
      'packages/core/content-manager/server/src/routes/admin.ts',
    )

    expect(routes.map((r) => r.path)).toEqual(['/content-manager/x'])
  })

  it('skips a route whose method or path is not a literal', () => {
    const { routes } = extract(
      `
      export default {
        type: 'admin',
        routes: [
          { method: verb, path: '/a', handler: 'a.b' },
          { method: 'GET', path: dynamicPath, handler: 'a.b' },
          { method: 'GET', path: '/ok', handler: 'a.b' },
        ],
      }
    `,
      'packages/core/upload/server/src/routes/admin.ts',
    )

    expect(routes.map((r) => r.path)).toEqual(['/upload/ok'])
  })
})
