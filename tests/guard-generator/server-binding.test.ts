import { describe, expect, it } from 'vitest'
import {
  bindFlowServer,
  servedByOtherApp,
  type ServerRouteIndex,
} from '@truecourse/guard-generator'

function routeIndex(): ServerRouteIndex {
  return {
    manifest: {
      apps: [
        {
          dir: 'apps/api/v2',
          framework: 'nest',
          routes: ['/v2/bookings'],
          prefixes: ['/v2', '/v2/bookings'],
          opaque: false,
        },
        {
          dir: 'apps/web',
          framework: 'next',
          routes: ['/api/version'],
          prefixes: ['/api', '/api/version'],
          opaque: true,
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
})
