/**
 * THE SCREEN OBSERVER in a real browser, against `guard-fixture-web`: the
 * accessibility tree an authoring session is handed, read off the served
 * surface exactly as a scenario would drive it.
 *
 * This suite deliberately fails when Chromium is unavailable — the observation
 * is what interface authoring now grounds on, and a silently skipped suite
 * would leave that unverified.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import {
  boundTree,
  createSandbox,
  createWebObserver,
  launchWebBrowser,
  MAX_OBSERVATION_BYTES,
  startWebSurface,
  type WebBrowserHandle,
  type WebScreenObserver,
  type WebSurfaceHandle,
} from '@truecourse/guard-runner'
import { makeTempRepo, rmrf } from './helpers.js'

const FIXTURE_WEB_SERVER = fileURLToPath(new URL('../fixtures/guard-fixture-web/server.mjs', import.meta.url))

describe('the screen observer', () => {
  let repo: string
  let sandbox: ReturnType<typeof createSandbox>
  let server: WebSurfaceHandle
  let browser: WebBrowserHandle
  let observer: WebScreenObserver

  beforeAll(async () => {
    repo = makeTempRepo()
    sandbox = createSandbox({})
    const started = await startWebSurface({
      surface: { serve: ['node', FIXTURE_WEB_SERVER], cwd: 'sandbox', healthPath: '/health', readyTimeoutMs: 20_000, env: {} },
      repoRoot: repo,
      sandboxCwd: sandbox.cwd,
      sandboxEnv: sandbox.env,
    })
    if (!started.ok) throw new Error(started.reason)
    server = started.server
    const launched = await launchWebBrowser({})
    if (!launched.ok) throw new Error(launched.reason)
    browser = launched.browser
    const created = await createWebObserver({
      browser,
      baseUrl: server.baseUrl,
      credential: { name: 'webSession', credential: { header: 'Cookie', value: 'session=abc' } },
    })
    if (!created.ok) throw new Error(created.reason)
    observer = created.observer
  }, 60_000)

  afterAll(async () => {
    await observer?.close()
    await browser?.close()
    await server?.stop()
    sandbox?.cleanup()
    rmrf(repo)
  })

  it('names the principal it is signed in as', () => {
    expect(observer.principal).toBe('webSession')
  })

  it('reads the tree of an address: every control by role and accessible name', async () => {
    const result = await observer.observe({ path: '/' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.observation.address).toBe('/')
    expect(result.observation.tree).toContain('heading "Guard Web Fixture"')
    expect(result.observation.tree).toContain('link "Notes"')
    expect(result.observation.tree).toContain('button "Reveal"')
    expect(result.observation.tree).toContain('textbox "Title"')
    expect(result.observation.omittedLines).toBe(0)
    expect(result.observation.problems).toEqual([])
  }, 30_000)

  it('activates targets before looking, and reports where each one left the page', async () => {
    const result = await observer.observe({ path: '/', activate: [{ role: 'button', name: 'Reveal' }] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.observation.activated).toEqual(['button "Reveal" → now at /'])
    expect(result.observation.tree).toContain('the secret is out')
  }, 30_000)

  it('follows a navigation an activation caused', async () => {
    const result = await observer.observe({ path: '/', activate: [{ role: 'link', name: 'Notes' }] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.observation.address).toBe('/notes')
    expect(result.observation.tree).toContain('heading "Notes"')
  }, 30_000)

  it('refuses a target the page does not have, naming what it tried', async () => {
    const result = await observer.observe({ path: '/', activate: [{ role: 'button', name: 'Nowhere' }] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/activating button "Nowhere" on \/ failed/)
  }, 30_000)

  it('refuses a path that still carries a slot, and one that does not start at the root', async () => {
    expect(await observer.observe({ path: '/repos/{id}' })).toMatchObject({ ok: false, reason: expect.stringMatching(/slot/) })
    expect(await observer.observe({ path: 'notes' })).toMatchObject({ ok: false, reason: expect.stringMatching(/start with/) })
  })

  it('refuses an address that resolves off the served surface', async () => {
    expect(await observer.observe({ path: '//elsewhere.example/x' })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/leaves the served surface \(http:\/\/elsewhere\.example\)/),
    })
  })

  it('signs every observation in afresh: one that signs out leaves the next one signed in', async () => {
    const out = await observer.observe({ path: '/sign-out' })
    expect(out.ok && out.observation.tree).toContain('heading "Signed out"')
    const next = await observer.observe({ path: '/whoami' })
    expect(next.ok && next.observation.tree).toContain('cookie: session=abc')
  }, 30_000)

  it('reports a status the address answered with, rather than hiding a broken screen', async () => {
    const result = await observer.observe({ path: '/no-such-screen' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.observation.problems).toContain('the address answered HTTP 404')
  }, 30_000)

  it('lists the controls the tree shows with no name, with what a css locator is written from', async () => {
    const result = await observer.observe({ path: '/icons' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const unnamed = result.observation.unnamed ?? []
    expect(unnamed).toContainEqual({
      tag: 'button',
      attributes: { 'data-action': 'sort' },
      icon: 'i.bi-chevron-expand',
      region: 'main',
      selector: 'button[data-action="sort"]',
      matches: 1,
    })
    // A glyph for a name is no name: it is listed with its code point, and
    // the only selector it has is its position inside its region.
    expect(unnamed).toContainEqual(expect.objectContaining({ tag: 'button', glyph: 'U+E0A1', selector: 'main button', matches: 6, position: 2 }))
    expect(unnamed.filter((control) => control.icon === 'i.bi-trash').map((control) => [control.selector, control.matches, control.position]))
      .toEqual([['main button:has(i.bi-trash)', 2, 1], ['main button:has(i.bi-trash)', 2, 2]])
    // A widget's state attribute is listed but never chosen over its test id,
    // and a long value is cut.
    const trigger = unnamed.find((control) => control.attributes['data-testid'] === 'menu-trigger')
    expect(trigger?.selector).toBe('button[data-testid="menu-trigger"]')
    expect(trigger?.attributes['data-state']).toBe('closed')
    expect(trigger?.attributes['data-hint']).toBe(`${'h'.repeat(120)}…`)
    // A utility class is escaped into a selector that parses and matches.
    expect(unnamed).toContainEqual(expect.objectContaining({ icon: 'i.w-\\[16px\\]', selector: 'button:has(i.w-\\[16px\\])', matches: 1 }))
    // Named controls are the tree's business, not this list's.
    expect(unnamed.some((control) => control.attributes.title === 'More')).toBe(false)
  }, 30_000)

  it('probes a locator the way the runner resolves it: its scope, its matches, and the one it picks', async () => {
    const probed = await observer.probe({
      path: '/icons',
      steps: [
        { resolve: { title: 'More' } },
        { resolve: { title: 'More', within: { css: 'main' } } },
        { resolve: { css: 'button:has(i.bi-trash)', pick: 2 } },
        { resolve: { css: 'button:has(i.bi-trash)', pick: 3 } },
      ],
    })
    expect(probed).toEqual({
      ok: true,
      readings: [
        { matches: 2, visible: false },
        { scopeMatches: 1, matches: 1, visible: true },
        { matches: 2, visible: true },
        { matches: 2, visible: false },
      ],
    })
  }, 30_000)

  it('reads each locator where the walk stands: before and after a click', async () => {
    const probed = await observer.probe({
      path: '/',
      steps: [
        { resolve: { text: 'the secret is out' } },
        { activate: { role: 'button', name: 'Reveal' } },
        { resolve: { text: 'the secret is out' } },
      ],
    })
    expect(probed).toEqual({ ok: true, readings: [{ matches: 0, visible: false }, { matches: 1, visible: true }] })
  }, 30_000)

  it('stops the walk at an action that fails, keeping the readings taken before it', async () => {
    const probed = await observer.probe({
      path: '/icons',
      steps: [{ resolve: { title: 'More', within: { css: 'main' } } }, { activate: { role: 'button', name: 'Nowhere' } }, { resolve: { css: 'main' } }],
    })
    expect(probed.ok).toBe(false)
    if (probed.ok) return
    expect(probed.reason).toContain('activating button "Nowhere"')
    expect(probed.readings).toEqual([{ scopeMatches: 1, matches: 1, visible: true }])
  }, 30_000)

  it('runs two observations side by side without one seeing the other', async () => {
    const [a, b] = await Promise.all([
      observer.observe({ path: '/', activate: [{ role: 'button', name: 'Reveal' }] }),
      observer.observe({ path: '/' }),
    ])
    expect(a.ok && a.observation.tree).toContain('the secret is out')
    expect(b.ok && b.observation.tree).not.toContain('the secret is out')
  }, 30_000)
})

describe('the observation budget', () => {
  it('cuts a long tree at a line and counts what it left out', () => {
    const line = `- listitem "${'x'.repeat(90)}"`
    const lines = Array.from({ length: 400 }, () => line)
    const bounded = boundTree(lines.join('\n'))
    expect(Buffer.byteLength(bounded.tree)).toBeLessThanOrEqual(MAX_OBSERVATION_BYTES)
    expect(bounded.tree.endsWith(line)).toBe(true)
    expect(bounded.omittedLines).toBe(400 - bounded.tree.split('\n').length)
    expect(bounded.omittedLines).toBeGreaterThan(0)
  })

  it('keeps a short tree whole', () => {
    expect(boundTree('- button "Save"')).toEqual({ tree: '- button "Save"', omittedLines: 0 })
  })
})

describe('the screen observer with a header credential', () => {
  let repo: string
  let sandbox: ReturnType<typeof createSandbox>
  let server: WebSurfaceHandle
  let browser: WebBrowserHandle

  beforeAll(async () => {
    repo = makeTempRepo()
    sandbox = createSandbox({})
    const started = await startWebSurface({
      surface: { serve: ['node', FIXTURE_WEB_SERVER], cwd: 'sandbox', healthPath: '/health', readyTimeoutMs: 20_000, env: {} },
      repoRoot: repo,
      sandboxCwd: sandbox.cwd,
      sandboxEnv: sandbox.env,
    })
    if (!started.ok) throw new Error(started.reason)
    server = started.server
    const launched = await launchWebBrowser({})
    if (!launched.ok) throw new Error(launched.reason)
    browser = launched.browser
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await server?.stop()
    sandbox?.cleanup()
    rmrf(repo)
  })

  it('sends the header to the served surface', async () => {
    const created = await createWebObserver({
      browser,
      baseUrl: server.baseUrl,
      credential: { name: 'apiToken', credential: { header: 'Authorization', value: 'Bearer t0k3n' } },
    })
    if (!created.ok) throw new Error(created.reason)
    const seen = await created.observer.observe({ path: '/whoami' })
    expect(seen.ok && seen.observation.tree).toContain('authorization: Bearer t0k3n')
    await created.observer.close()
  }, 30_000)
})
