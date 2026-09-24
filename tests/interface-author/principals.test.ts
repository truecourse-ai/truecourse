/**
 * WHO SEES A SCREEN — each screen is observed as the principal its source asks
 * for, and when the first look is sent away from the address, the first
 * principal that stays is the one its session observes as.
 */

import { describe, it, expect } from 'vitest'
import type { ObserveScreenResult } from '@truecourse/guard-runner'
import type { LiveScreenObserver, LiveScreens } from '../../packages/core/src/services/interface-author/live-screen'
import {
  observeAsPrincipal,
  principalHint,
  principalOrder,
} from '../../packages/core/src/services/interface-author/principals'
import { webPrincipals } from '../../packages/core/src/services/guard-setup/live-screens'

/** An observer that ends at `endsAt(path)` and remembers what it was asked. */
function observer(principal: string | undefined, endsAt: (path: string) => string, seen: string[]): LiveScreenObserver {
  return {
    ...(principal ? { principal } : {}),
    async observe({ path }): Promise<ObserveScreenResult> {
      seen.push(`${principal ?? 'nobody'} ${path}`)
      return { ok: true, observation: { path, address: endsAt(path), title: '', tree: `- heading "${principal}"`, omittedLines: 0, activated: [], problems: [] } }
    },
    async probe() {
      return { ok: true, readings: [] }
    },
    async close() {},
  }
}

function world(seen: string[], admin = true): LiveScreens {
  const member = observer('webSession', (path) => (path.startsWith('/admin') || path === '/login' ? '/dashboard' : path), seen)
  const principals = new Map<string, LiveScreenObserver>([
    ['webSession', member],
    ...(admin ? [['adminWebSession', observer('adminWebSession', (path) => (path === '/login' ? '/dashboard' : path), seen)] as const] : []),
    ['anonymous', observer('anonymous', (path) => (path === '/login' ? path : '/login'), seen)],
  ])
  return { observer: member, principals }
}

describe('the principal a screen asks for', () => {
  it('reads a signed-out page off its address or its source, and an admin page off an admin guard', () => {
    expect(principalHint('/login', undefined)).toBe('anonymous')
    expect(principalHint('/auth/reset-password', undefined)).toBe('anonymous')
    expect(principalHint('/welcome', 'if (session) { return { redirect: { destination: "/dashboard" } } }')).toBe('anonymous')
    expect(principalHint('/admin/user-administration', undefined)).toBe('admin')
    expect(principalHint('/jobs', 'if (user.id !== (config.ADMIN || 1)) router.replace("/dashboard")')).toBe('admin')
    expect(principalHint('/jobs', "if (session.user.role !== 'admin') notFound()")).toBe('admin')
    expect(principalHint('/links', 'const t = useTranslation(); t("admin_settings")')).toBeUndefined()
  })

  it('tries the hinted principal first, then the default, and the signed-out browser last', () => {
    const live = world([])
    expect(principalOrder(live, 'admin')).toEqual(['adminWebSession', 'webSession', 'anonymous'])
    expect(principalOrder(live, 'anonymous')).toEqual(['anonymous', 'webSession', 'adminWebSession'])
    expect(principalOrder(live, undefined)).toEqual(['webSession', 'adminWebSession', 'anonymous'])
  })

  it("prefers the seed's principals by name: its admin for an admin page, then admin, member and empty after the default", () => {
    const own = observer('webSession', (path) => path, [])
    const names = ['webSession', 'otherSession', 'emptyWebSession', 'superAdminSession', 'memberWebSession', 'adminWebSession', 'anonymous']
    const live: LiveScreens = { observer: own, principals: new Map(names.map((name) => [name, observer(name, (path) => path, [])])) }
    expect(principalOrder(live, 'admin')).toEqual([
      'adminWebSession', 'superAdminSession', 'webSession', 'memberWebSession', 'emptyWebSession', 'otherSession', 'anonymous',
    ])
    expect(principalOrder(live, undefined)).toEqual([
      'webSession', 'adminWebSession', 'memberWebSession', 'emptyWebSession', 'otherSession', 'superAdminSession', 'anonymous',
    ])
  })
})

describe('observing a screen as the principal that stays', () => {
  it('keeps the hinted principal when it stays', async () => {
    const seen: string[] = []
    const choice = await observeAsPrincipal(world(seen), '/admin/users', 'admin')
    expect(choice).toMatchObject({ principal: 'adminWebSession', reached: true })
    expect(seen).toEqual(['adminWebSession /admin/users'])
  })

  it('falls back through the others when the first look is sent away, keeping the first that stays', async () => {
    const seen: string[] = []
    const choice = await observeAsPrincipal(world(seen, false), '/login', undefined)
    expect(choice).toMatchObject({ principal: 'anonymous', reached: true })
    expect(seen).toEqual(['webSession /login', 'anonymous /login'])
  })

  it('says the screen is unreached when every principal is sent away, keeping the first look', async () => {
    const seen: string[] = []
    const choice = await observeAsPrincipal(world(seen, false), '/admin/users', 'admin')
    expect(choice.reached).toBe(false)
    expect(choice.principal).toBe('webSession')
    expect(choice.observation.ok && choice.observation.observation.address).toBe('/dashboard')
  })
})

describe('the web sessions a browser signs in with', () => {
  it("takes every Cookie credential, the seed's owner first and its admin, member and empty sessions after any other", () => {
    const cookie = (value: string) => ({ header: 'Cookie', value })
    expect(
      webPrincipals(new Map([
        ['emptyWebSession', cookie('e=1')],
        ['adminWebSession', cookie('a=1')],
        ['apiToken', { header: 'Authorization', value: 'Bearer x' }],
        ['teamSession', cookie('t=1')],
        ['webSession', cookie('s=1')],
        ['memberWebSession', cookie('m=1')],
        ['empty', cookie('')],
      ])).map((principal) => principal.name),
    ).toEqual(['webSession', 'teamSession', 'adminWebSession', 'memberWebSession', 'emptyWebSession'])
    expect(webPrincipals(new Map([['apiToken', { header: 'Authorization', value: 'Bearer x' }]])).map((p) => p.name)).toEqual(['apiToken'])
  })
})
