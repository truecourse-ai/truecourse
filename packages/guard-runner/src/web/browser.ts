/**
 * The browser half of the web driver: one headless Chromium, one clean context,
 * ONE page per scenario — the api driver's "each scenario boots its own world and
 * shares nothing" rule, applied to the browser.
 *
 * The browser belongs to the RUNNER process, not to the sandbox. It is test
 * apparatus, exactly like the HTTP client the api driver drives its server with:
 * the sandbox's allowlisted env and redirected HOME are the world the APP under
 * test must live in, and running the instrument inside them would only mean the
 * instrument cannot find its own binary.
 *
 * Determinism is pinned the way the sandbox pins env: a fixed viewport (a
 * responsive layout hides controls at some widths, and a scenario must not pass or
 * fail on the developer's window size), a fixed device scale, no animations
 * carried over between scenarios because nothing is carried over between
 * scenarios.
 *
 * The binary is NOT downloaded on demand. A missing browser is a loud, actionable
 * message naming the install command — never a mid-run network fetch, which would
 * make a run's cost depend on what happened to be cached.
 */

import fs from 'node:fs'
import path from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'

/**
 * The pinned viewport. 1280×800 is the smallest common desktop size at which a
 * conventional app shows its full navigation — small enough to be a real window,
 * large enough that nothing collapses behind a hamburger.
 */
export const WEB_VIEWPORT = { width: 1280, height: 800 } as const

/** The video file every web session leaves in its evidence directory. */
export const WEB_VIDEO_FILE = 'session.webm'

export interface WebBrowserHandle {
  /** The one page every web step of the scenario acts on. */
  page: Page
  /** Everything the page logged, in order, as `level: text`. */
  consoleLines(): readonly string[]
  /** Page errors (uncaught exceptions) — the console's louder half. */
  pageErrors(): readonly string[]
  /**
   * Close the page, the context and the browser, and finish the video. Idempotent.
   * Returns the video's filename inside the evidence dir, or null when none landed.
   */
  close(): Promise<string | null>
}

export interface LaunchWebBrowserOptions {
  /**
   * Where the session video is recorded. The scenario's evidence directory: a
   * browser run's evidence is visual, and a video is the only artifact that shows
   * what happened BETWEEN two steps' screenshots.
   */
  videoDir: string
}

/**
 * The message a missing browser binary earns — it names the one command that fixes
 * it. The engine never downloads mid-run (§10.3), so this is the whole remedy.
 */
export const BROWSER_MISSING_MESSAGE =
  'the web driver needs the Chromium browser, which is not installed — run ' +
  '`pnpm exec playwright-core install chromium` (guard never downloads a browser mid-run)'

/** True when the browser binary the runner would launch is not on this machine. */
export function isBrowserInstalled(): boolean {
  try {
    return fs.existsSync(chromium.executablePath())
  } catch {
    return false
  }
}

/**
 * Launch the browser and open the scenario's page, or report why it could not be
 * launched. A failure is INFRASTRUCTURE by construction — no page ever existed to
 * assert against — so it is returned rather than thrown, and the caller settles the
 * scenario as an `error` naming the reason.
 */
export async function launchWebBrowser(
  opts: LaunchWebBrowserOptions,
): Promise<{ ok: true; browser: WebBrowserHandle } | { ok: false; reason: string }> {
  if (!isBrowserInstalled()) return { ok: false, reason: BROWSER_MISSING_MESSAGE }
  fs.mkdirSync(opts.videoDir, { recursive: true })

  let browser: Browser
  try {
    browser = await chromium.launch({ headless: true })
  } catch (e) {
    return { ok: false, reason: `the browser failed to launch: ${e instanceof Error ? e.message : String(e)}` }
  }

  let context: BrowserContext
  let page: Page
  try {
    context = await browser.newContext({
      viewport: { ...WEB_VIEWPORT },
      deviceScaleFactor: 1,
      recordVideo: { dir: opts.videoDir, size: { ...WEB_VIEWPORT } },
    })
    page = await context.newPage()
  } catch (e) {
    await browser.close().catch(() => undefined)
    return { ok: false, reason: `the browser context failed to open: ${e instanceof Error ? e.message : String(e)}` }
  }

  const consoleLines: string[] = []
  const pageErrors: string[] = []
  page.on('console', (message) => {
    consoleLines.push(`${message.type()}: ${message.text()}`)
  })
  page.on('pageerror', (error) => {
    pageErrors.push(error.message)
  })

  let closed: string | null = null
  let isClosed = false

  const close = async (): Promise<string | null> => {
    if (isClosed) return closed
    isClosed = true
    const video = page.video()
    // The context must go down before the video file is complete — that is the
    // recorder's contract, not a race we are choosing to run.
    await context.close().catch(() => undefined)
    if (video) {
      const target = path.join(opts.videoDir, WEB_VIDEO_FILE)
      try {
        await video.saveAs(target)
        closed = WEB_VIDEO_FILE
      } catch {
        // A scenario whose first step failed to boot may have no frames; the
        // transcript then simply names no video.
      }
      await video.delete().catch(() => undefined)
    }
    await browser.close().catch(() => undefined)
    return closed
  }

  return {
    ok: true,
    browser: {
      page,
      consoleLines: () => consoleLines,
      pageErrors: () => pageErrors,
      close,
    },
  }
}
