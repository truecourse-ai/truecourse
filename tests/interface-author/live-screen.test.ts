/**
 * THE LIVE SCREEN in the authoring run: what a session is told and handed when
 * the run stood the app up. The observer here is a FAKE — what is under test is
 * the contract around it: which screens get their tree in the briefing (an
 * address with no slot), which are told to observe for themselves (a slotted
 * one), the tool every session gets, and what a run with no observer looks
 * like (exactly as before).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { guardInterfacesPath } from '@truecourse/guard-runner'
import type { InterfacesFile } from '../../packages/shared/src/index'
import { runGuardInterfaceAuthoring } from '../../packages/core/src/commands/guard-interfaces'
import {
  liveScreenLines,
  observeScreenTool,
  publicFixtureFields,
  renderObservation,
  type LiveScreenObserver,
  type LiveScreens,
  type ObserveScreenResult,
  type ScreenObservationRequest,
} from '../../packages/core/src/services/interface-author/live-screen'
import { stubDriver, outcome, toolResult } from '../core/spec-scan-session-stub.js'
import { installMemorySessionRuns, resetSessionRuns } from '../helpers/memory-session-runs'
import { installMemoryKvCache, resetKvCacheStore } from '../helpers/memory-kv-cache'

const DERIVED: InterfacesFile = {
  version: 2,
  generatedAt: '2026-09-22T00:00:00.000Z',
  recipeFingerprint: 'sha256:recipe',
  interfaces: [],
  resources: {
    web: [
      { id: 'root', kind: 'screen', title: '/', address: '/' },
      { id: 'links-id', kind: 'screen', title: '/links/{id}', address: '/links/{id}' },
    ],
  },
  source: { web: 'tree' },
}

/** An observer that answers from a script and remembers what it was asked. */
function fakeObserver(principal?: string): { observer: LiveScreenObserver; requests: ScreenObservationRequest[] } {
  const requests: ScreenObservationRequest[] = []
  const observer: LiveScreenObserver = {
    ...(principal ? { principal } : {}),
    async observe(request) {
      requests.push(request)
      if (/\{[^}]*\}/.test(request.path)) return { ok: false, reason: 'the path still carries a slot' }
      if (request.path === '/broken') return { ok: false, reason: 'opening /broken failed: net::ERR_CONNECTION_REFUSED' }
      const opened = (request.activate ?? []).map((target) => `${'role' in target ? target.role : 'text'} ${JSON.stringify('name' in target ? target.name : '')} → now at ${request.path}`)
      return {
        ok: true,
        observation: {
          path: request.path,
          address: request.path,
          title: `Page ${request.path}`,
          tree: [`- heading "Links" [level=1]`, `- button "Add link"`, ...(opened.length ? [`- dialog "Add link":`, `  - textbox "URL"`] : [])].join('\n'),
          omittedLines: 0,
          activated: opened,
          problems: [],
        },
      }
    },
    async probe() {
      return { ok: false, reason: 'this fake proves nothing' }
    },
    async close() {},
  }
  return { observer, requests }
}

let repo: string
beforeEach(() => {
  installMemorySessionRuns()
  installMemoryKvCache()
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-live-screen-'))
  fs.mkdirSync(path.dirname(guardInterfacesPath(repo)), { recursive: true })
  fs.writeFileSync(guardInterfacesPath(repo), JSON.stringify(DERIVED))
})
afterEach(() => {
  resetSessionRuns()
  resetKvCacheStore()
  fs.rmSync(repo, { recursive: true, force: true })
})

const toolContext = { signal: new AbortController().signal } as never

describe('the briefing block', () => {
  it('states the tree of an address with no slot, and whose principal is signed in', () => {
    const { observer } = fakeObserver('webSession')
    const observation: ObserveScreenResult = {
      ok: true,
      observation: { path: '/', address: '/', title: 'Home', tree: '- button "Add link"', omittedLines: 0, activated: [], problems: [] },
    }
    const text = liveScreenLines({ live: { observer }, address: '/', observation }).join('\n')
    expect(text).toContain('THE LIVE SCREEN')
    expect(text).toContain('signed in as the seeded principal `webSession`')
    expect(text).toContain('Observed / — title "Home"')
    expect(text).toContain('- button "Add link"')
    expect(text).toContain('observe_screen')
  })

  it('tells a slotted address to observe itself, with the seeded fixtures to fill the slot', () => {
    const { observer } = fakeObserver()
    const text = liveScreenLines({
      live: { observer, fixtures: { link: { id: 7, url: 'https://example.com' } } },
      address: '/links/{id}',
    }).join('\n')
    expect(text).toContain('with no principal signed in')
    expect(text).toContain('carries a slot')
    expect(text).toContain('link: {"id":7,"url":"https://example.com"}')
  })

  it('says why an address could not be observed instead of saying nothing', () => {
    const { observer } = fakeObserver()
    const text = liveScreenLines({ live: { observer }, address: '/', observation: { ok: false, reason: 'the address answered HTTP 500' } }).join('\n')
    expect(text).toContain('could not be observed: the address answered HTTP 500')
  })

  it('renders what an activation opened and what the budget left out', () => {
    const text = renderObservation({
      path: '/', address: '/', title: '', tree: '- dialog "Add link"', omittedLines: 12,
      activated: ['button "Add link" → now at /'], problems: ['console error: boom'],
    })
    expect(text).toContain('activated button "Add link" → now at /')
    expect(text).toContain('problem: console error: boom')
    expect(text).toContain('12 more line(s)')
  })

  it('keeps the unnamed controls inside a byte budget and counts what it cut', () => {
    const control = { tag: 'button', attributes: { 'data-hint': `${'h'.repeat(120)}…` }, selector: 'main button', matches: 40 }
    const text = renderObservation({
      path: '/', address: '/', title: '', tree: '- main', omittedLines: 0, activated: [], problems: [],
      unnamed: Array.from({ length: 200 }, (_, i) => ({ ...control, position: i + 1 })),
    })
    expect(Buffer.byteLength(text)).toBeLessThan(10_000)
    expect(text).toMatch(/… \d+ more unnamed control\(s\) not shown/)
  })

  it('lists clickable elements with no role by their text, and overlays with no dialog role by a container selector', () => {
    const text = renderObservation({
      path: '/', address: '/', title: '', tree: '- main', omittedLines: 0, activated: [], problems: [],
      unnamed: [{ tag: 'div', attributes: {}, selector: 'div', matches: 30, position: 4, noRole: true, text: 'Work' }],
      containers: [{ tag: 'div', attributes: {}, heading: 'Delete link', controls: 3, selector: 'div:has(> button[data-testid="close"])', matches: 1 }],
    })
    expect(text).toContain('Clickable elements with NO interactive role')
    expect(text).toContain('div · text "Work" · css `div` (30 matches, this is #4)')
    expect(text).not.toContain('Controls the tree shows with NO accessible name')
    expect(text).toContain('div · heading "Delete link" · 3 control(s) · css `div:has(> button[data-testid="close"])` (1 match)')
  })
})

describe('the fixtures a session may see', () => {
  it('drops every secret-shaped field and every fixture that only had those', () => {
    expect(publicFixtureFields(new Map([
      ['webUser', { id: 3, email: 'a@b.c', password: 'hunter2', apiToken: 'tok', sessionCookie: 'x' }],
      ['secrets', { signingKey: 'k' }],
    ]))).toEqual({ webUser: { id: 3, email: 'a@b.c' } })
  })
})

describe('the observe_screen tool', () => {
  it('opens a filled address, activates in order, and returns the tree', async () => {
    const { observer, requests } = fakeObserver()
    const tool = observeScreenTool({ observer })
    const result = await tool.execute({ path: '/links/7', activate: [{ role: 'button', name: 'Add link' }] }, toolContext)
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('activated button "Add link" → now at /links/7')
    expect(result.content).toContain('- textbox "URL"')
    expect(requests).toEqual([{ path: '/links/7', activate: [{ role: 'button', name: 'Add link' }] }])
  })

  it('hands a refusal back as a tool error the session can act on', async () => {
    const { observer } = fakeObserver()
    const result = await observeScreenTool({ observer }).execute({ path: '/links/{id}' }, toolContext)
    expect(result.isError).toBe(true)
    expect(result.content).toContain('still carries a slot')
  })

  it('takes no more than five activations, and only real locators', () => {
    const { observer } = fakeObserver()
    const schema = observeScreenTool({ observer }).inputSchema
    expect(schema.safeParse({ path: '/', activate: Array(6).fill({ role: 'button', name: 'x' }) }).success).toBe(false)
    expect(schema.safeParse({ path: '/', activate: [{ xpath: '//button' }] }).success).toBe(false)
    expect(schema.safeParse({ path: '/', activate: [{ css: 'main button:has(i.bi-three-dots)' }] }).success).toBe(true)
    expect(schema.safeParse({ path: '/', activate: [{ label: 'URL' }] }).success).toBe(true)
  })
})

describe('the run', () => {
  it('observes every screen whose address has no slot before its session, and briefs each session with what it saw', async () => {
    const { observer, requests } = fakeObserver('webSession')
    const live: LiveScreens = { observer, fixtures: { link: { id: 7 } } }
    const { driver, calls } = stubDriver(async (call) => {
      const tools = call.def.tools.map((tool) => tool.name)
      expect(tools).toContain('observe_screen')
      await call.emit(toolResult('check_draft'))
      return outcome({ interfaces: [], unresolved: ['nothing to do here'] })
    })
    const run = await runGuardInterfaceAuthoring({ repoRoot: repo, driver, transportMode: 'api', openLive: async () => live })
    expect(run.places.map((place) => place.placeId).sort()).toEqual(['links-id', 'root'])
    // The first look: the literal address only. The slotted one is the session's to fill.
    expect(requests).toEqual([{ path: '/' }])
    const rootBriefing = calls.find((call) => call.briefing.includes('place    root'))!.briefing
    expect(rootBriefing).toContain('THE LIVE SCREEN')
    expect(rootBriefing).toContain('signed in as the seeded principal `webSession`')
    expect(rootBriefing).toContain('- button "Add link"')
    const slottedBriefing = calls.find((call) => call.briefing.includes('place    links-id'))!.briefing
    expect(slottedBriefing).toContain('carries a slot')
    expect(slottedBriefing).toContain('link: {"id":7}')
    expect(slottedBriefing).not.toContain('Observed /')
  })

  it('lets a session look for itself through the tool, at a filled address', async () => {
    const { observer, requests } = fakeObserver()
    const { driver } = stubDriver(async (call) => {
      if (call.briefing.includes('place    links-id')) {
        const tool = call.def.tools.find((candidate) => candidate.name === 'observe_screen')!
        const seen = await tool.execute({ path: '/links/7' }, toolContext)
        expect(seen.content).toContain('Observed /links/7')
      }
      await call.emit(toolResult('check_draft'))
      return outcome({ interfaces: [], unresolved: ['nothing to do here'] })
    })
    await runGuardInterfaceAuthoring({ repoRoot: repo, driver, transportMode: 'api', openLive: async () => ({ observer }) })
    expect(requests).toEqual([{ path: '/' }, { path: '/links/7' }])
  })

  it('briefs and tools a run with no observer exactly as before', async () => {
    const { driver, calls } = stubDriver(async (call) => {
      expect(call.def.tools.map((tool) => tool.name)).not.toContain('observe_screen')
      await call.emit(toolResult('check_draft'))
      return outcome({ interfaces: [], unresolved: ['nothing to do here'] })
    })
    await runGuardInterfaceAuthoring({ repoRoot: repo, driver, transportMode: 'api' })
    expect(calls.every((call) => !call.briefing.includes('THE LIVE SCREEN'))).toBe(true)
  })

  it('keeps a fragment authored from source apart from one authored beside the live screen', async () => {
    const { observer } = fakeObserver()
    let opened = 0
    const openLive = async (): Promise<LiveScreens> => { opened++; return { observer } }
    const { driver, calls } = stubDriver(async (call) => {
      await call.emit(toolResult('check_draft'))
      return outcome({ interfaces: [], unresolved: ['nothing to do here'] })
    })
    const author = (withLive: boolean) =>
      runGuardInterfaceAuthoring({ repoRoot: repo, driver, transportMode: 'api', places: ['root'], ...(withLive ? { openLive } : {}) })

    // From source: a session runs, and the world is never asked for.
    await author(false)
    expect([calls.length, opened]).toEqual([1, 0])
    // The world can come up now: the source fragment is not served, the screen is authored live.
    await author(true)
    expect([calls.length, opened]).toEqual([2, 1])
    // Each run is served its own kind from the cache, and a live hit boots nothing.
    await author(false)
    await author(true)
    expect([calls.length, opened]).toEqual([2, 1])
  })
})
