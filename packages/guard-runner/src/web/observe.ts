/**
 * THE SCREEN OBSERVER — one signed-in browser that opens an address of the
 * served surface and hands back what an assistive reader would see: the
 * page's ACCESSIBILITY TREE, one line per node, `role "name"` with the states
 * the element exposes. That tree is the locator vocabulary a web step may use
 * (`{"role": "button", "name": "Save"}`), so what it lists is exactly what a
 * task can target, and what it lacks is exactly what `unresolved` must name.
 *
 * Beside the tree it reports the page's UNNAMED controls ({@link UnnamedControl}):
 * the ones the tree lists with an empty or glyph-only name, and the clickable
 * ones it lists as text because they carry no role, with the DOM facts a locator
 * is written from — and the unnamed overlays a step cannot be scoped to by role
 * ({@link UnnamedContainer}). And it PROBES locators
 * ({@link WebScreenObserver.probe}): it walks an ordered list of actions on one
 * page — clicks, fills, selects, navigations — and at each point it is asked to,
 * reads how many elements a locator matches and whether the one it resolves to
 * is visible — the live proof a non-canonical locator is held to before it is
 * authored.
 *
 * It is READ-ONLY in intent, not by construction: an observation may ACTIVATE
 * a few controls before it looks (open a menu, a dialog, a tab), because a
 * dialog's controls exist only once it is open, and a probe may also type into
 * a field or choose an option on its way to a control that only shows after.
 * The caller's doctrine decides what may be pressed; this module only refuses nothing and reports
 * everything, the final address included, so a click that navigated is
 * visible as one.
 *
 * Every observation gets its OWN BROWSER CONTEXT, signed in afresh — an
 * activation that signs out or rotates the session cookie changes that one
 * observation's jar, never the next one's, and two observations in flight
 * never see each other's state. The credential reaches the served surface
 * and nothing else: its cookies are scoped to the surface's origin, any other
 * header is added only to requests for that origin, and an address that
 * resolves to another origin is refused before anything is opened. The
 * contexts are closed with their observation; the browser and the server
 * belong to whoever opened them.
 */

import type { BrowserContext, Page } from 'playwright-core'
import { describeInterfaceTarget, type GuardWebLocator } from '@truecourse/shared'
import { hasAddressSlot } from './address.js'
import { parseCookieHeader, type WorldCredential } from './credential.js'
import { webLocator, webLocatorMatches, pageAddress } from './executor.js'
import { WEB_CONTEXT_OPTIONS, type WebBrowserHandle } from './browser.js'
import { readUnnamedElements, type UnnamedContainer, type UnnamedControl } from './unnamed-controls.js'
import { openPage, settlePage, type PageReachedBy } from './open-page.js'

/** How much of one accessibility tree an observation carries. A tree is
 *  context, and context is the budget; a screen past this is cut at a line
 *  and the cut is counted. */
export const MAX_OBSERVATION_BYTES = 24_000

/** How long one activation and one read of the tree may each take. */
export const OBSERVE_ACTIVATE_TIMEOUT_MS = 5_000
export const OBSERVE_SETTLE_TIMEOUT_MS = 3_000

export interface ScreenObservationRequest {
  /** The address to open, path and query, as the routing declares it with every slot filled. */
  path: string
  /** Controls to activate before looking, in order — a menu to open, a tab to select. */
  activate?: readonly GuardWebLocator[]
}

export interface ScreenObservation {
  /** The address asked for. */
  path: string
  /** Where the page ended up — the same address unless something redirected or navigated. */
  address: string
  /** How the address was reached ({@link openPage}); absent when no load and no link in the UI reached it. */
  reachedBy?: PageReachedBy
  title: string
  /** The accessibility tree, one node per line, as far as the byte budget allows. */
  tree: string
  /** How many lines the budget left out; 0 when the whole tree is here. */
  omittedLines: number
  /** What each activation did, one line per target, in order. */
  activated: string[]
  /** Page errors and console errors the load raised — a broken screen says so. */
  problems: string[]
  /** The interactive elements the tree lists with an empty or glyph-only name,
   *  and the clickable ones it lists as text because they carry no role. */
  unnamed?: UnnamedControl[]
  /** The fixed overlays holding controls with no `dialog` role — modals no role+name scopes. */
  containers?: UnnamedContainer[]
}

export type ObserveScreenResult =
  | { ok: true; observation: ScreenObservation }
  | { ok: false; reason: string }

/**
 * One step of a probe's walk: an action that moves the page on (a click, a
 * value typed, an option chosen, an address opened), or a `resolve` that reads
 * a locator where the walk stands.
 */
export type LocatorProbeStep =
  | { activate: GuardWebLocator }
  | { fill: GuardWebLocator; value: string }
  | { select: GuardWebLocator; option: string }
  | { navigate: string }
  | { resolve: GuardWebLocator }

export interface LocatorProbeRequest {
  /** The address to open first, every slot filled. */
  path: string
  /** The walk, in order, on that one page. */
  steps: readonly LocatorProbeStep[]
}

/** What one locator resolved to on the live page. */
export interface LocatorReading {
  /** How many elements its `within` scope matches, when it has one. */
  scopeMatches?: number
  /** How many elements its handle matches inside that scope, before its own `pick`. */
  matches: number
  /** The element it resolves to (after `pick`) exists exactly once and is visible. */
  visible: boolean
}

/**
 * One reading per `resolve` of the walk, in order. A walk that stopped (an
 * action failed, an address would not open) says why, with the readings it took
 * before it stopped.
 */
export type LocatorProbeResult =
  | { ok: true; readings: LocatorReading[] }
  | { ok: false; reason: string; readings?: LocatorReading[] }

export interface WebScreenObserver {
  /** The credential the pages are signed in with, by name; absent when anonymous. */
  readonly principal?: string
  observe(request: ScreenObservationRequest): Promise<ObserveScreenResult>
  /** Open an address and walk the probe's steps on it, reading each locator it is asked to. */
  probe(request: LocatorProbeRequest): Promise<LocatorProbeResult>
  /** Close the contexts this observer has open. The browser stays the caller's. */
  close(): Promise<void>
}

export interface CreateWebObserverOptions {
  browser: WebBrowserHandle
  /** `http://127.0.0.1:<port>` of the served surface. */
  baseUrl: string
  /** The credential every page carries, when the world minted one for the web. */
  credential?: { name: string; credential: WorldCredential }
}

/**
 * An observer over an already-launched browser and an already-running surface.
 * A credential that cannot be installed is refused here, once, rather than on
 * every observation.
 */
export async function createWebObserver(opts: CreateWebObserverOptions): Promise<
  { ok: true; observer: WebScreenObserver } | { ok: false; reason: string }
> {
  const browser = opts.browser.page.context().browser()
  if (!browser) return { ok: false, reason: 'the browser handle carries no browser to open contexts on' }
  if (opts.credential && opts.credential.credential.header.toLowerCase() === 'cookie' &&
    parseCookieHeader(opts.credential.credential.value).length === 0) {
    return {
      ok: false,
      reason: `credential "${opts.credential.name}" is a Cookie header holding no name=value pair — nothing to install`,
    }
  }
  const open = new Set<BrowserContext>()
  /** Run `look` on a fresh signed-in page, in a context of its own that closes after. */
  const onFreshPage = async <T>(look: (page: Page) => Promise<T | { ok: false; reason: string }>) => {
    let context: BrowserContext
    try {
      context = await browser.newContext(WEB_CONTEXT_OPTIONS)
    } catch (e) {
      return { ok: false as const, reason: `the browser could not open a context: ${firstLine(e)}` }
    }
    open.add(context)
    try {
      if (opts.credential) await signIn(context, opts.baseUrl, opts.credential.credential)
      return await look(await context.newPage())
    } catch (e) {
      return { ok: false as const, reason: `the browser could not open a signed-in page: ${firstLine(e)}` }
    } finally {
      open.delete(context)
      await context.close().catch(() => undefined)
    }
  }
  const observer: WebScreenObserver = {
    ...(opts.credential ? { principal: opts.credential.name } : {}),
    observe: (request) => onFreshPage((page) => observeScreen(page, opts.baseUrl, request)),
    probe: (request) => onFreshPage((page) => probeLocator(page, opts.baseUrl, request)),
    async close() {
      for (const context of open) await context.close().catch(() => undefined)
      open.clear()
    },
  }
  return { ok: true, observer }
}

/**
 * Put the credential into one context for the surface at `baseUrl` only: a
 * `Cookie` header becomes cookies scoped to its origin, any other header is
 * added to the requests bound for that origin and to no other.
 */
async function signIn(context: BrowserContext, baseUrl: string, credential: WorldCredential): Promise<void> {
  if (credential.header.toLowerCase() === 'cookie') {
    await context.addCookies(parseCookieHeader(credential.value).map((cookie) => ({ ...cookie, url: baseUrl })))
    return
  }
  const origin = new URL(baseUrl).origin
  await context.route(
    (url) => url.origin === origin,
    (route) => route.continue({ headers: { ...route.request().headers(), [credential.header]: credential.value } }),
  )
}

/** Open `request.path` on `page`, activate what was asked, and read the tree. */
export async function observeScreen(
  page: Page,
  baseUrl: string,
  request: ScreenObservationRequest,
): Promise<ObserveScreenResult> {
  const opened = await openAndActivate(page, baseUrl, request)
  if (!opened.ok) return opened
  let tree: string
  try {
    tree = await page.locator('body').ariaSnapshot({ timeout: OBSERVE_SETTLE_TIMEOUT_MS })
  } catch (e) {
    return { ok: false, reason: `reading the accessibility tree of ${pageAddress(page)} failed: ${firstLine(e)}` }
  }
  const bounded = boundTree(tree)
  const { controls: unnamed, containers } = await readUnnamedElements(page)
  return {
    ok: true,
    observation: {
      path: request.path,
      address: pageAddress(page),
      ...(opened.reachedBy ? { reachedBy: opened.reachedBy } : {}),
      title: await page.title().catch(() => ''),
      tree: bounded.tree,
      omittedLines: bounded.omittedLines,
      activated: opened.activated,
      problems: opened.problems,
      ...(unnamed.length > 0 ? { unnamed } : {}),
      ...(containers.length > 0 ? { containers } : {}),
    },
  }
}

/**
 * Open `request.path` on `page` and walk the probe's steps there. Each `resolve`
 * reads its locator the way the runner resolves it: its scope, every match of its
 * handle, and the one element its `pick` (if any) leaves. An action that fails
 * stops the walk; the readings taken before it are kept.
 */
export async function probeLocator(
  page: Page,
  baseUrl: string,
  request: LocatorProbeRequest,
): Promise<LocatorProbeResult> {
  const opened = await openAndActivate(page, baseUrl, { path: request.path })
  if (!opened.ok) return opened
  if (!opened.reachedBy) return { ok: false, reason: opened.problems[opened.problems.length - 1] ?? `${request.path} could not be reached` }
  const readings: LocatorReading[] = []
  for (const step of request.steps) {
    const failed = await probeStep(page, baseUrl, step, readings)
    if (failed) return { ok: false, reason: failed, readings }
  }
  return { ok: true, readings }
}

/** Run one step of a probe's walk, pushing its reading; returns why it failed, if it did. */
async function probeStep(
  page: Page,
  baseUrl: string,
  step: LocatorProbeStep,
  readings: LocatorReading[],
): Promise<string | undefined> {
  if ('navigate' in step) {
    const url = surfaceUrl(step.navigate, baseUrl)
    if (!url.ok) return url.reason
    const opened = await openPage(page, url.url, baseUrl)
    if (!opened.ok) return opened.reason
    return opened.reached ? undefined : unreachedLine(step.navigate, opened.sentTo)
  }
  if ('resolve' in step) {
    const { resolve: locator } = step
    try {
      const scopeMatches = locator.within ? await webLocator(page, locator.within).count() : undefined
      const matches = await webLocatorMatches(page, locator).count()
      const resolved = webLocator(page, locator)
      const visible = (await resolved.count()) === 1 && (await resolved.isVisible())
      readings.push({ ...(scopeMatches !== undefined ? { scopeMatches } : {}), matches, visible })
      return undefined
    } catch (e) {
      return `resolving ${describeLocator(locator)} on ${pageAddress(page)} failed: ${firstLine(e)}`
    }
  }
  const [verb, target] =
    'activate' in step ? ['activating', step.activate] as const
      : 'fill' in step ? ['filling', step.fill] as const
        : ['selecting in', step.select] as const
  const locator = webLocator(page, target)
  try {
    if ('activate' in step) await locator.click({ timeout: OBSERVE_ACTIVATE_TIMEOUT_MS })
    else if ('fill' in step) await locator.fill(step.value, { timeout: OBSERVE_ACTIVATE_TIMEOUT_MS })
    else await locator.selectOption({ label: step.option }, { timeout: OBSERVE_ACTIVATE_TIMEOUT_MS })
  } catch (e) {
    return `${verb} ${describeLocator(target)} on ${pageAddress(page)} failed: ${firstLine(e)}`
  }
  await settlePage(page)
  return undefined
}

/** The shared half of an observation and a probe: open the address, then activate. */
async function openAndActivate(
  page: Page,
  baseUrl: string,
  request: ScreenObservationRequest,
): Promise<
  { ok: true; activated: string[]; problems: string[]; reachedBy?: PageReachedBy } | { ok: false; reason: string }
> {
  if (!request.path.startsWith('/')) {
    return { ok: false, reason: `the path must start with "/" (got ${JSON.stringify(request.path)})` }
  }
  if (hasAddressSlot(request.path)) {
    return {
      ok: false,
      reason: `the path still carries a slot (${request.path}) — fill every {param} with a real value before observing`,
    }
  }
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(`page error: ${firstLine(error)}`))
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console error: ${message.text().split('\n')[0]}`)
  })

  const resolved = surfaceUrl(request.path, baseUrl)
  if (!resolved.ok) return resolved
  const opened = await openPage(page, resolved.url, baseUrl)
  if (!opened.ok) return opened
  if (opened.status !== undefined && opened.status >= 400) problems.push(`the address answered HTTP ${opened.status}`)
  const activated: string[] = []
  if (!opened.reached) {
    // Activating controls on a page the browser was sent to would act on another screen.
    problems.push(unreachedLine(request.path, opened.sentTo))
    return { ok: true, activated, problems }
  }
  for (const target of request.activate ?? []) {
    const locator = webLocator(page, target)
    const label = describeLocator(target)
    try {
      await locator.click({ timeout: OBSERVE_ACTIVATE_TIMEOUT_MS })
    } catch (e) {
      return {
        ok: false,
        reason: `activating ${label} on ${pageAddress(page)} failed: ${firstLine(e)}` +
          (activated.length > 0 ? ` (after: ${activated.join('; ')})` : ''),
      }
    }
    await settlePage(page)
    activated.push(`${label} → now at ${pageAddress(page)}`)
  }
  return { ok: true, activated, problems, reachedBy: opened.by }
}

/** The line an address no load and no link reached is reported with. */
function unreachedLine(path: string, sentTo: string): string {
  return `${path} could not be reached: every load was sent to ${sentTo}, and no link in the app's UI leads to it`
}

/**
 * The absolute URL of a path on the served surface. A path like
 * `//elsewhere.example/x` starts with "/" and still leaves the surface, so the
 * address is checked where it resolves, not where it starts.
 */
function surfaceUrl(path: string, baseUrl: string): { ok: true; url: string } | { ok: false; reason: string } {
  const resolved = new URL(path, baseUrl)
  if (resolved.origin !== new URL(baseUrl).origin) {
    return { ok: false, reason: `the path ${JSON.stringify(path)} leaves the served surface (${resolved.origin})` }
  }
  return { ok: true, url: resolved.toString() }
}

/** The tree (or any list of lines) cut at a line boundary inside a byte budget, with the rest counted. */
export function boundTree(tree: string, maxBytes = MAX_OBSERVATION_BYTES): { tree: string; omittedLines: number } {
  if (Buffer.byteLength(tree) <= maxBytes) return { tree, omittedLines: 0 }
  const lines = tree.split('\n')
  const kept: string[] = []
  let bytes = 0
  for (const line of lines) {
    const size = Buffer.byteLength(line) + 1
    if (bytes + size > maxBytes) break
    kept.push(line)
    bytes += size
  }
  return { tree: kept.join('\n'), omittedLines: lines.length - kept.length }
}

/** `button "Save"` / `css "main button" within navigation "Sidebar"` — the target as an authored step writes it. */
function describeLocator(target: GuardWebLocator): string {
  const member = describeInterfaceTarget(target)
  return target.within ? `${member} within ${describeInterfaceTarget(target.within)}` : member
}

function firstLine(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  return message.split('\n')[0].trim()
}
