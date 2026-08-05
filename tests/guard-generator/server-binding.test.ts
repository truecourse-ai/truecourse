import { describe, expect, it } from 'vitest'
import {
  bindFlowServer,
  servedByOtherApp,
  type ServerRouteIndex,
} from '@truecourse/guard-generator'
import type { RouteManifestApp } from '@truecourse/guard-runner'

/**
 * The cal.com/cal.diy shape: a Nest `/v2` api whose routes are exact facts, and a
 * proxying Next web app that declares `/api/version` — hence the coarse `/api`
 * prefix it also claims but does not own.
 */
function routeIndex(webOverrides: Partial<RouteManifestApp> = {}): ServerRouteIndex {
  return {
    manifest: {
      apps: [
        {
          dir: 'apps/api/v2',
          framework: 'nest',
          routes: ['/v2/bookings'],
          prefixes: ['/v2', '/v2/bookings'],
          opaque: false,
          pathsShifted: false,
        },
        {
          dir: 'apps/web',
          framework: 'next',
          routes: ['/api/version'],
          prefixes: ['/api', '/api/version'],
          opaque: true,
          pathsShifted: false,
          ...webOverrides,
        },
      ],
    },
    serverByApp: new Map([
      ['apps/api/v2', 'api-v2'],
      ['apps/web', 'web'],
    ]),
    appByServer: new Map([
      ['api-v2', 'apps/api/v2'],
      ['web', 'apps/web'],
    ]),
  }
}

describe('server binding for opaque apps', () => {
  it('binds a positively matched route to its declared server', () => {
    expect(bindFlowServer(['/api/version'], routeIndex())).toMatchObject({
      kind: 'bound',
      server: 'web',
    })
  })

  it('recognizes a positively matched route as belonging to another app', () => {
    expect(servedByOtherApp(routeIndex(), 'apps/api/v2', '/api/version')).toBe(true)
  })

  it('keeps an unmatched route unknown because an opaque app may proxy it', () => {
    expect(bindFlowServer(['/forwarded-only'], routeIndex())).toEqual({ kind: 'unbound' })
    expect(servedByOtherApp(routeIndex(), 'apps/api/v2', '/forwarded-only')).toBe(false)
  })

  it('ignores an opaque app that only claims the path by prefix — it may merely forward it', () => {
    // `/api/v1/oauth/token` is documented, and apps/web claims `/api/*` purely
    // because it happens to declare `/api/version`. For a proxy that says nothing.
    expect(bindFlowServer(['/api/v1/oauth/token'], routeIndex())).toEqual({ kind: 'unbound' })
    expect(servedByOtherApp(routeIndex(), 'apps/api/v2', '/api/v1/oauth/token')).toBe(false)
  })

  it('never blocks on an opaque app that claims the path by prefix alone', () => {
    const index = routeIndex()
    index.serverByApp.delete('apps/web')
    index.appByServer.delete('web')
    expect(bindFlowServer(['/api/v1/oauth/token'], index)).toEqual({ kind: 'unbound' })
  })

  it('still binds on a prefix claim from an app that is not a proxy', () => {
    // `/v2/bookings/42/cancel` matches no template; the non-opaque Nest app's
    // `/v2` prefix is a fair ownership statement, so the coarse claim still counts.
    expect(bindFlowServer(['/v2/bookings/42/cancel'], routeIndex())).toMatchObject({
      kind: 'bound',
      server: 'api-v2',
    })
    expect(servedByOtherApp(routeIndex(), 'apps/web', '/v2/bookings/42/cancel')).toBe(true)
  })
})

describe('server binding for apps whose discovered paths are shifted', () => {
  it('contributes nothing even on an exact route match — the real URL carries a basePath', () => {
    const index = routeIndex({ pathsShifted: true })
    expect(bindFlowServer(['/api/version'], index)).toEqual({ kind: 'unbound' })
    expect(servedByOtherApp(index, 'apps/api/v2', '/api/version')).toBe(false)
  })

  it('never blocks on a shifted app with no declared server', () => {
    const index = routeIndex({ pathsShifted: true })
    index.serverByApp.delete('apps/web')
    index.appByServer.delete('web')
    expect(bindFlowServer(['/api/version'], index)).toEqual({ kind: 'unbound' })
  })
})
