/**
 * WHO A SCREEN IS SEEN AS — the engine chooses no principal: it asks which of
 * them reach an address, and orders the browsers the seed's sessions sign in.
 */

import { describe, it, expect } from 'vitest'
import type { LocatorProbeResult, ObserveScreenResult } from '@truecourse/guard-runner'
import type { LiveScreenObserver, LiveScreens } from '../../packages/core/src/services/interface-author/live-screen'
import { principalDescription } from '../../packages/core/src/services/interface-author/live-screen'
import { principalsReaching } from '../../packages/core/src/services/interface-author/principals'
import { webPrincipals } from '../../packages/core/src/services/guard-setup/live-screens'

/** An observer that reaches only the paths `reaches` admits, and remembers what it was asked. */
function observer(principal: string | undefined, reaches: (path: string) => boolean, seen: string[]): LiveScreenObserver {
  return {
    ...(principal ? { principal } : {}),
    async observe({ path }): Promise<ObserveScreenResult> {
      return { ok: true, observation: { path, address: path, title: '', tree: '', omittedLines: 0, activated: [], problems: [], reachedBy: 'load' } }
    },
    async probe({ path }): Promise<LocatorProbeResult> {
      seen.push(`${principal ?? 'nobody'} ${path}`)
      return reaches(path) ? { ok: true, readings: [] } : { ok: false, reason: `${path} could not be reached`, unreached: path }
    },
    async close() {},
  }
}

function world(seen: string[]): LiveScreens {
  const owner = observer('webSession', (path) => !path.startsWith('/admin') && path !== '/login', seen)
  return {
    observer: owner,
    principals: new Map([
      ['webSession', owner],
      ['instanceAdminWebSession', observer('instanceAdminWebSession', (path) => path !== '/login', seen)],
      ['anonymous', observer('anonymous', (path) => path === '/login', seen)],
    ]),
    descriptions: new Map([['webSession', 'owns the seeded links'], ['instanceAdminWebSession', 'the instance admin (user id 1)']]),
  }
}

describe('which principals reach an address', () => {
  it('asks every principal, the default first, and keeps the ones the page did not send away', async () => {
    const seen: string[] = []
    expect(await principalsReaching(world(seen), '/admin/users')).toEqual(['instanceAdminWebSession'])
    expect(seen).toEqual(['webSession /admin/users', 'instanceAdminWebSession /admin/users', 'anonymous /admin/users'])
    expect(await principalsReaching(world([]), '/login')).toEqual(['anonymous'])
    expect(await principalsReaching(world([]), '/nowhere-but-owner')).toEqual(['webSession', 'instanceAdminWebSession'])
  })

  it('answers none for an address no principal reaches', async () => {
    const live: LiveScreens = { observer: observer('webSession', () => false, []) }
    expect(await principalsReaching(live, '/admin')).toEqual([])
  })
})

describe('what makes a principal distinct', () => {
  it("reads the seed's description, and describes the signed-out browser itself", () => {
    const live = world([])
    expect(principalDescription(live, 'instanceAdminWebSession')).toBe('the instance admin (user id 1)')
    expect(principalDescription(live, 'anonymous')).toMatch(/signed in as nobody/)
    expect(principalDescription(live, 'unknown')).toBeUndefined()
  })
})

describe('the web sessions a browser signs in with', () => {
  it("takes every Cookie credential in the seed's order, its owner first", () => {
    const cookie = (value: string) => ({ header: 'Cookie', value })
    expect(
      webPrincipals(new Map([
        ['viewerWebSession', cookie('v=1')],
        ['apiToken', { header: 'Authorization', value: 'Bearer x' }],
        ['adminWebSession', cookie('a=1')],
        ['webSession', cookie('s=1')],
        ['empty', cookie('')],
      ])).map((principal) => principal.name),
    ).toEqual(['webSession', 'viewerWebSession', 'adminWebSession'])
    // With no owner named, the default is the first web session the seed declares.
    expect(
      webPrincipals(new Map([['viewerWebSession', cookie('v=1')], ['adminWebSession', cookie('a=1')]])).map((p) => p.name),
    ).toEqual(['viewerWebSession', 'adminWebSession'])
    expect(webPrincipals(new Map([['apiToken', { header: 'Authorization', value: 'Bearer x' }]])).map((p) => p.name)).toEqual(['apiToken'])
  })
})
