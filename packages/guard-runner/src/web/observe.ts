/**
 * THE SCREEN OBSERVER — one signed-in browser that opens an address of the
 * served surface and hands back what an assistive reader would see: the
 * page's ACCESSIBILITY TREE, one line per node, `role "name"` with the states
 * the element exposes. That tree is the locator vocabulary a web step may use
 * (`{"role": "button", "name": "Save"}`), so what it lists is exactly what a
 * task can target, and what it lacks is exactly what `unresolved` must name.
 *
 * It is READ-ONLY in intent, not by construction: an observation may ACTIVATE
 * a few controls before it looks (open a menu, a dialog, a tab), because a
 * dialog's controls exist only once it is open. The caller's doctrine decides
 * what may be pressed; this module only refuses nothing and reports
 * everything, the final address included, so a click that navigated is
 * visible as one.
 *
 * Every observation gets its OWN PAGE in the shared context — the cookies a
 * credential installed are the context's, so every page is signed in, while
 * two observations in flight never see each other's state. The pages are
 * closed with the observation; the browser and the server belong to whoever
 * opened them.
 */

import type { Page } from 'playwright-core'
import type { GuardWebLocator } from '@truecourse/shared'
import { installWebCredential, type WorldCredential } from './credential.js'
import { webLocator, pageAddress } from './executor.js'
import type { WebBrowserHandle } from './browser.js'

/** How much of one accessibility tree an observation carries. A tree is
 *  context, and context is the budget; a screen past this is cut at a line
 *  and the cut is counted. */
export const MAX_OBSERVATION_BYTES = 24_000

/** How long one navigation, one activation and one settle may each take. */
export const OBSERVE_NAVIGATION_TIMEOUT_MS = 30_000
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
  title: string
  /** The accessibility tree, one node per line, as far as the byte budget allows. */
  tree: string
  /** How many lines the budget left out; 0 when the whole tree is here. */
  omittedLines: number
  /** What each activation did, one line per target, in order. */
  activated: string[]
  /** Page errors and console errors the load raised — a broken screen says so. */
  problems: string[]
}

export type ObserveScreenResult =
  | { ok: true; observation: ScreenObservation }
  | { ok: false; reason: string }

export interface WebScreenObserver {
  /** The credential the pages are signed in with, by name; absent when anonymous. */
  readonly principal?: string
  observe(request: ScreenObservationRequest): Promise<ObserveScreenResult>
  /** Close the pages this observer opened. The browser stays the caller's. */
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
 * The credential is installed once, on the browser's context (a `Cookie`
 * header becomes the context's cookies; any other header is set on each page).
 */
export async function createWebObserver(opts: CreateWebObserverOptions): Promise<
  { ok: true; observer: WebScreenObserver } | { ok: false; reason: string }
> {
  const context = opts.browser.page.context()
  const headers: Record<string, string> = {}
  if (opts.credential) {
    const installed = await installWebCredential(
      opts.browser.page,
      opts.baseUrl,
      opts.credential.name,
      opts.credential.credential,
      headers,
    )
    if (!installed.ok) return { ok: false, reason: installed.reason }
  }
  const open = new Set<Page>()
  const observer: WebScreenObserver = {
    ...(opts.credential ? { principal: opts.credential.name } : {}),
    async observe(request) {
      let page: Page
      try {
        page = await context.newPage()
      } catch (e) {
        return { ok: false, reason: `the browser could not open a page: ${firstLine(e)}` }
      }
      open.add(page)
      try {
        if (Object.keys(headers).length > 0) await page.setExtraHTTPHeaders(headers)
        return await observeScreen(page, opts.baseUrl, request)
      } finally {
        open.delete(page)
        await page.close().catch(() => undefined)
      }
    },
    async close() {
      for (const page of open) await page.close().catch(() => undefined)
      open.clear()
    },
  }
  return { ok: true, observer }
}

/** Open `request.path` on `page`, activate what was asked, and read the tree. */
export async function observeScreen(
  page: Page,
  baseUrl: string,
  request: ScreenObservationRequest,
): Promise<ObserveScreenResult> {
  if (!request.path.startsWith('/')) {
    return { ok: false, reason: `the path must start with "/" (got ${JSON.stringify(request.path)})` }
  }
  if (/\{[^}]*\}/.test(request.path)) {
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

  const url = new URL(request.path, baseUrl).toString()
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: OBSERVE_NAVIGATION_TIMEOUT_MS })
    if (response && response.status() >= 400) problems.push(`the address answered HTTP ${response.status()}`)
  } catch (e) {
    return { ok: false, reason: `opening ${request.path} failed: ${firstLine(e)}` }
  }
  await settle(page)

  const activated: string[] = []
  for (const target of request.activate ?? []) {
    const locator = webLocator(page, target)
    const label = describeTarget(target)
    try {
      await locator.click({ timeout: OBSERVE_ACTIVATE_TIMEOUT_MS })
    } catch (e) {
      return {
        ok: false,
        reason: `activating ${label} on ${pageAddress(page)} failed: ${firstLine(e)}` +
          (activated.length > 0 ? ` (after: ${activated.join('; ')})` : ''),
      }
    }
    await settle(page)
    activated.push(`${label} → now at ${pageAddress(page)}`)
  }

  let tree: string
  try {
    tree = await page.locator('body').ariaSnapshot({ timeout: OBSERVE_SETTLE_TIMEOUT_MS })
  } catch (e) {
    return { ok: false, reason: `reading the accessibility tree of ${pageAddress(page)} failed: ${firstLine(e)}` }
  }
  const bounded = boundTree(tree)
  return {
    ok: true,
    observation: {
      path: request.path,
      address: pageAddress(page),
      title: await page.title().catch(() => ''),
      tree: bounded.tree,
      omittedLines: bounded.omittedLines,
      activated,
      problems,
    },
  }
}

/** Wait for the network to go quiet, briefly — a screen that never does is still a screen. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: OBSERVE_SETTLE_TIMEOUT_MS }).catch(() => undefined)
}

/** The tree cut at a line boundary inside the byte budget, with the rest counted. */
export function boundTree(tree: string): { tree: string; omittedLines: number } {
  if (Buffer.byteLength(tree) <= MAX_OBSERVATION_BYTES) return { tree, omittedLines: 0 }
  const lines = tree.split('\n')
  const kept: string[] = []
  let bytes = 0
  for (const line of lines) {
    const size = Buffer.byteLength(line) + 1
    if (bytes + size > MAX_OBSERVATION_BYTES) break
    kept.push(line)
    bytes += size
  }
  return { tree: kept.join('\n'), omittedLines: lines.length - kept.length }
}

/** `button "Save"` — the target as an authored step writes it. */
function describeTarget(target: GuardWebLocator): string {
  const member =
    'role' in target ? `${target.role} ${JSON.stringify(target.name)}`
      : 'label' in target ? `label ${JSON.stringify(target.label)}`
        : 'placeholder' in target ? `placeholder ${JSON.stringify(target.placeholder)}`
          : 'text' in target ? `text ${JSON.stringify(target.text)}`
            : 'title' in target ? `title ${JSON.stringify(target.title)}`
              : `alt ${JSON.stringify(target.alt)}`
  return target.within ? `${member} within ${target.within.role} ${JSON.stringify(target.within.name)}` : member
}

function firstLine(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  return message.split('\n')[0].trim()
}
