/**
 * The route manifest: which workspace app serves which HTTP path,
 * read off the tree with nothing but FS + regex.
 *
 * The asymmetry is the point (R6): every negative case below — a path nobody
 * declares, an app with no readable routes, an app that may proxy — must answer
 * "unknown", because the callers turn a POSITIVE attribution into a blocked flow.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRouteManifest, whichAppServes, type RouteManifest } from '@truecourse/guard-runner'
import { makeTempRepo, rmrf } from './helpers.js'

/** The committed two-app fixture: a Next web app and a Nest `/v2` api app. */
const MONOREPO = fileURLToPath(new URL('../fixtures/route-manifest-monorepo', import.meta.url))

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

/** A throwaway repo with the given files written into it (content verbatim). */
function repoWith(files: Record<string, string>): string {
  const r = makeTempRepo()
  repos.push(r)
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(r, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }
  return r
}

function app(manifest: RouteManifest, dir: string) {
  const found = manifest.apps.find((a) => a.dir === dir)
  if (!found) throw new Error(`no app ${dir} in [${manifest.apps.map((a) => a.dir).join(', ')}]`)
  return found
}

describe('buildRouteManifest — app discovery', () => {
  it('finds the workspace apps declared by the root package.json, nested ones included', () => {
    const manifest = buildRouteManifest(MONOREPO)
    expect(manifest.apps.map((a) => a.dir)).toEqual(['apps/api/v2', 'apps/web'])
    expect(app(manifest, 'apps/web').pkg).toBe('@fixture/web')
    expect(app(manifest, 'apps/api/v2').pkg).toBe('@fixture/api-v2')
    expect(app(manifest, 'apps/web').framework).toBe('next')
    expect(app(manifest, 'apps/api/v2').framework).toBe('nest')
  })

  it('falls back to the conventional homes when the repo declares no workspaces', () => {
    const r = repoWith({
      'services/edge/package.json': JSON.stringify({ name: 'edge', dependencies: { next: '14' } }),
      'services/edge/pages/api/ping.ts': 'export default () => {}',
    })
    const manifest = buildRouteManifest(r)
    expect(manifest.apps.map((a) => a.dir)).toEqual(['services/edge'])
    expect(app(manifest, 'services/edge').routes).toEqual(['/api/ping'])
  })
})

describe('buildRouteManifest — Next.js', () => {
  it('reads both routers: pages/api, app-router dynamic segments, and route groups', () => {
    const web = app(buildRouteManifest(MONOREPO), 'apps/web')
    expect(web.routes).toEqual(['/api/book/{id}', '/api/version', '/pricing'])
    expect(web.opaque).toBe(false)
  })

  it('drops `index` and normalizes catch-all segments', () => {
    const r = repoWith({
      'package.json': JSON.stringify({ name: 'root', workspaces: ['apps/*'] }),
      'apps/w/package.json': JSON.stringify({ name: 'w', dependencies: { next: '14' } }),
      'apps/w/pages/api/index.ts': '',
      'apps/w/pages/api/webhooks/[...slug].ts': '',
      'apps/w/src/app/api/[[...proxy]]/route.ts': '',
    })
    expect(app(buildRouteManifest(r), 'apps/w').routes).toEqual([
      '/api',
      '/api/webhooks/{...slug}',
      '/api/{...proxy}',
    ])
  })

  it('marks an app whose next.config rewrites paths as opaque — it may serve what it never declares', () => {
    const r = repoWith({
      'package.json': JSON.stringify({ name: 'root', workspaces: ['apps/*'] }),
      'apps/w/package.json': JSON.stringify({ name: 'w', dependencies: { next: '14' } }),
      'apps/w/next.config.js': 'module.exports = { async rewrites() { return [] } }',
      'apps/w/pages/api/version.ts': '',
    })
    const w = app(buildRouteManifest(r), 'apps/w')
    expect(w.opaque).toBe(true)
    // Still a real route list — opacity is a caller-side degrade, not amnesia.
    expect(w.routes).toEqual(['/api/version'])
    // A rewriting app may serve MORE; the paths it does declare are still its own.
    expect(w.pathsShifted).toBe(false)
  })

  it('marks an app whose next.config sets a basePath as shifted — its declared paths are not its URLs', () => {
    const r = repoWith({
      'package.json': JSON.stringify({ name: 'root', workspaces: ['apps/*'] }),
      'apps/w/package.json': JSON.stringify({ name: 'w', dependencies: { next: '14' } }),
      'apps/w/next.config.js': "module.exports = { basePath: '/console' }",
      'apps/w/pages/api/version.ts': '',
    })
    const w = app(buildRouteManifest(r), 'apps/w')
    expect(w.opaque).toBe(true)
    expect(w.pathsShifted).toBe(true)
  })

  it('leaves a plain Next app neither opaque nor shifted', () => {
    const web = app(buildRouteManifest(MONOREPO), 'apps/web')
    expect(web.opaque).toBe(false)
    expect(web.pathsShifted).toBe(false)
  })
})

describe('buildRouteManifest — NestJS', () => {
  it('composes setGlobalPrefix + controller + method and normalizes :params', () => {
    const api = app(buildRouteManifest(MONOREPO), 'apps/api/v2')
    expect(api.routes).toEqual(['/v2/bookings', '/v2/bookings/{id}'])
    expect(api.prefixes).toEqual(['/v2', '/v2/bookings'])
    expect(api.opaque).toBe(false)
  })

  it('treats a Nest app with no controller file as opaque, never as "serves nothing"', () => {
    const r = repoWith({
      'package.json': JSON.stringify({ name: 'root', workspaces: ['apps/*'] }),
      'apps/svc/package.json': JSON.stringify({ name: 'svc', dependencies: { '@nestjs/core': '10' } }),
      'apps/svc/src/main.ts': "app.setGlobalPrefix('v3')",
    })
    const svc = app(buildRouteManifest(r), 'apps/svc')
    expect(svc.opaque).toBe(true)
    // Unread routes are missing, not shifted — nothing here is wrong, only absent.
    expect(svc.pathsShifted).toBe(false)
    expect(svc.routes).toEqual([])
  })
})

describe('buildRouteManifest — extraRoutes', () => {
  it('attributes analyzer-supplied routes to the app whose dir contains the file', () => {
    const manifest = buildRouteManifest(MONOREPO, {
      extraRoutes: [
        { path: '/v2/slots/:slotId', file: path.join(MONOREPO, 'apps/api/v2/src/slots/slots.controller.ts') },
        // A file under no discovered app contributes nothing — never an invented app.
        { path: '/orphan', file: path.join(MONOREPO, 'scripts/tool.ts') },
      ],
    })
    expect(app(manifest, 'apps/api/v2').routes).toContain('/v2/slots/{slotId}')
    expect(manifest.apps.flatMap((a) => a.routes)).not.toContain('/orphan')
  })
})

describe('whichAppServes', () => {
  const manifest = buildRouteManifest(MONOREPO)

  it('matches an exact template', () => {
    expect(whichAppServes(manifest, '/v2/bookings')).toMatchObject({
      app: { dir: 'apps/api/v2' },
      match: 'route',
    })
  })

  it('matches a param segment, query string and all', () => {
    expect(whichAppServes(manifest, '/v2/bookings/42?expand=user')).toMatchObject({
      app: { dir: 'apps/api/v2' },
      match: 'route',
    })
    expect(whichAppServes(manifest, '/api/book/xyz')).toMatchObject({ app: { dir: 'apps/web' }, match: 'route' })
  })

  it('falls back to a static prefix when no template matches exactly', () => {
    expect(whichAppServes(manifest, '/v2/bookings/42/cancel')).toMatchObject({
      app: { dir: 'apps/api/v2' },
      match: 'prefix',
    })
  })

  it('claims nothing for a path no app declares', () => {
    expect(whichAppServes(manifest, '/billing/invoices')).toBeNull()
    expect(whichAppServes(manifest, '')).toBeNull()
  })

  it('an app with zero detected routes never claims a path', () => {
    const r = repoWith({
      'package.json': JSON.stringify({ name: 'root', workspaces: ['apps/*'] }),
      'apps/mystery/package.json': JSON.stringify({ name: 'mystery' }),
      'apps/mystery/src/server.rb': 'get "/v2/bookings"',
    })
    const empty = buildRouteManifest(r)
    expect(app(empty, 'apps/mystery').routes).toEqual([])
    expect(whichAppServes(empty, '/v2/bookings')).toBeNull()
  })
})
