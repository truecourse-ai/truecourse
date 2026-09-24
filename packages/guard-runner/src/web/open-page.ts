/**
 * OPENING A PAGE — how the screen observer and the live proof arrive at an
 * address of the served surface.
 *
 * A direct load is not always where a user can stand. A client-side guard can
 * race its own data (a placeholder user compared before the real one loads)
 * and send even the right principal away on a fresh load, while a user who
 * arrives through the app's own navigation never meets it. So a page is opened
 * the way a person would get there, in order:
 *   1. load the address, and settle;
 *   2. when the browser ended elsewhere, load it again, up to
 *      {@link OPEN_PAGE_RETRIES} more times;
 *   3. open the app's start page (the surface's root) and follow a visible
 *      link whose `href` resolves to the address, first as the page stands,
 *      then after opening each of a bounded number of menus (a control that
 *      declares a popup, or a collapsed one), closing each again before the next.
 * The result says which way the page was reached, or that it was not, with
 * the address the last direct load was sent to.
 */

import type { Locator, Page } from 'playwright-core'

/** How many times a direct load is repeated after the first sends the browser away. */
export const OPEN_PAGE_RETRIES = 2

/** How many menus the UI navigation opens, at most, looking for a link to the address. */
export const OPEN_PAGE_MAX_MENUS = 6

/** How long one load, one click and one settle may each take. */
const LOAD_TIMEOUT_MS = 30_000
const CLICK_TIMEOUT_MS = 5_000
const SETTLE_TIMEOUT_MS = 3_000

/** Controls that open a menu or a collapsed region: what the UI navigation may press. */
const MENU_OPENERS = '[aria-haspopup]:not([aria-haspopup="false"]), [aria-expanded="false"], summary'

/** How a page was reached: its own load, a repeated load, or a link in the app's own UI. */
export type PageReachedBy = 'load' | 'retry' | 'navigation'

export type OpenPageResult =
  | { ok: true; reached: true; by: PageReachedBy; status?: number }
  | { ok: true; reached: false; sentTo: string; status?: number }
  | { ok: false; reason: string }

/**
 * Arrive at `url` (an absolute URL on the surface `baseUrl` serves) on
 * `page`; the app's start page is the surface's root. A load that throws stops
 * the attempt with its reason; a page that only ever redirects is `reached:
 * false`, and the page is left where the last attempt left it.
 */
export async function openPage(page: Page, url: string, baseUrl: string): Promise<OpenPageResult> {
  const target = new URL(url)
  let status: number | undefined
  let sentTo = ''
  for (let attempt = 0; attempt <= OPEN_PAGE_RETRIES; attempt++) {
    try {
      const response = await page.goto(url, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS })
      status = response?.status()
    } catch (e) {
      return { ok: false, reason: `opening ${target.pathname}${target.search} failed: ${firstLine(e)}` }
    }
    await settlePage(page)
    if (samePage(page.url(), target)) return { ok: true, reached: true, by: attempt === 0 ? 'load' : 'retry', ...withStatus(status) }
    sentTo = pathOf(page.url())
  }
  if (await navigateThroughUi(page, target, new URL('/', baseUrl).toString())) {
    return { ok: true, reached: true, by: 'navigation', ...withStatus(status) }
  }
  return { ok: true, reached: false, sentTo, ...withStatus(status) }
}

/**
 * Did the browser end on the page `target` names? The path is compared (a
 * trailing slash aside), and the query too when the target has one.
 */
export function samePage(ended: string, target: URL): boolean {
  const at = new URL(ended)
  if (trimSlash(at.pathname) !== trimSlash(target.pathname)) return false
  return target.search === '' || at.search === target.search
}

/** Wait for the network to go quiet, briefly: a page that never does is still a page. */
export async function settlePage(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => undefined)
}

/**
 * Open the start page and follow a link to `target`: first one visible as the
 * page stands, then one each menu shows once opened.
 */
async function navigateThroughUi(page: Page, target: URL, start: string): Promise<boolean> {
  try {
    await page.goto(start, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS })
  } catch {
    return false
  }
  await settlePage(page)
  const landing = page.url()
  if (await followLink(page, target)) return true
  const openers = page.locator(MENU_OPENERS)
  const count = Math.min(await openers.count().catch(() => 0), OPEN_PAGE_MAX_MENUS)
  for (let i = 0; i < count; i++) {
    if (page.url() !== landing) {
      await page.goto(landing, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS }).catch(() => undefined)
      await settlePage(page)
    }
    const opener = openers.nth(i)
    if (!(await opener.isVisible().catch(() => false))) continue
    const opened = await opener.click({ timeout: CLICK_TIMEOUT_MS }).then(() => true, () => false)
    if (!opened) continue
    await settlePage(page)
    if (await followLink(page, target)) return true
    await page.keyboard.press('Escape').catch(() => undefined)
  }
  return false
}

/** Click the first visible link whose `href` resolves to `target`, and say whether the browser ended there. */
async function followLink(page: Page, target: URL): Promise<boolean> {
  const links = page.locator('a[href]')
  const count = await links.count().catch(() => 0)
  for (let i = 0; i < count; i++) {
    const link: Locator = links.nth(i)
    const href = await link.getAttribute('href').catch(() => null)
    const resolved = href === null ? null : URL.parse(href, page.url())
    if (!resolved || !samePage(resolved.toString(), target) || !(await link.isVisible().catch(() => false))) continue
    const clicked = await link.click({ timeout: CLICK_TIMEOUT_MS }).then(() => true, () => false)
    if (!clicked) continue
    await page.waitForURL((url) => samePage(url.toString(), target), { timeout: CLICK_TIMEOUT_MS }).catch(() => undefined)
    await settlePage(page)
    if (samePage(page.url(), target)) return true
  }
  return false
}

function pathOf(url: string): string {
  const parsed = new URL(url)
  return `${parsed.pathname}${parsed.search}`
}

function trimSlash(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/'
}

function withStatus(status: number | undefined): { status?: number } {
  return status === undefined ? {} : { status }
}

function firstLine(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  return message.split('\n')[0].trim()
}
