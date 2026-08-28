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
 *
 * `playwright-core` itself is OPT-IN: an optional peerDependency of this package,
 * not a dependency, so a repo with no web surface never pays for a browser
 * automation library it will not run. That is why the only value import of it in
 * this package is the `await import()` below — a static import would load it at
 * module init for every guard run, cli-only ones included, and would be bundled
 * into the published CLI. Everything else imports `type`s, which erase.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { Browser, BrowserContext, BrowserType, FileChooser, Page } from 'playwright-core'

/**
 * The pinned viewport. 1280×800 is the smallest common desktop size at which a
 * conventional app shows its full navigation — small enough to be a real window,
 * large enough that nothing collapses behind a hamburger.
 */
export const WEB_VIEWPORT = { width: 1280, height: 800 } as const

/** The video file every web session leaves in its evidence directory. */
export const WEB_VIDEO_FILE = 'session.webm'

/** One armed wait for a file chooser — see {@link WebBrowserHandle.armFileChooser}. */
export interface ArmedFileChooser {
  /** The chooser the next click opens, or `null` when none opened in time. */
  next(timeoutMs: number): Promise<FileChooser | null>
}

export interface WebBrowserHandle {
  /** The one page every web step of the scenario acts on. */
  page: Page
  /** Everything the page logged, in order, as `level: text`. */
  consoleLines(): readonly string[]
  /** Page errors (uncaught exceptions) — the console's louder half. */
  pageErrors(): readonly string[]
  /**
   * Arm the page for the NEXT file chooser, and hand back the wait for it.
   *
   * Armed PER STEP, and arming DROPS whatever an earlier click left parked. Two
   * facts make that the only correct shape: Playwright only intercepts a chooser
   * while a listener is attached (so the listener is permanent, registered beside
   * the console ones below), and a chooser some earlier click opened and nobody
   * answered must never be handed to a later upload — that would report the file as
   * having reached a control it never touched, which is the "green for the wrong
   * reason" this engine exists to prevent.
   */
  armFileChooser(): ArmedFileChooser
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

/**
 * The message an absent `playwright-core` earns. It names BOTH commands, in order,
 * because installing the library alone still leaves no browser to launch — a
 * message that named only the first would just buy the user a second failure.
 */
export const PLAYWRIGHT_MISSING_MESSAGE =
  'the web driver needs `playwright-core`, which is not installed — add playwright-core, ' +
  'then run `playwright-core install chromium` (web steps are opt-in; guard never installs either one mid-run)'

/** The lazily-loaded `chromium` launcher, or the reason it could not be loaded. */
type ChromiumLoad = { ok: true; chromium: BrowserType } | { ok: false; reason: string }

/** True when the throw is Node saying the specifier resolved to nothing. */
function isModuleNotFound(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException | null)?.code
  return code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND'
}

/**
 * Load `playwright-core`. Absent is an EXPECTED outcome, not a crash: the package
 * is opt-in, so a repo that never declared a web surface has every right not to
 * have it, and a repo that did gets the two-command remedy instead of a stack trace.
 * A package that IS installed but throws on load is a different fault and says so —
 * reporting "not installed" for a broken install would send the user to the wrong fix.
 */
async function loadChromium(): Promise<ChromiumLoad> {
  try {
    const { chromium } = await import('playwright-core')
    return { ok: true, chromium }
  } catch (e) {
    if (isModuleNotFound(e)) return { ok: false, reason: PLAYWRIGHT_MISSING_MESSAGE }
    return {
      ok: false,
      reason: `playwright-core is installed but failed to load: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

/** True when the Chromium binary this launcher would start is on the machine. */
function isBinaryPresent(chromium: BrowserType): boolean {
  try {
    return fs.existsSync(chromium.executablePath())
  } catch {
    return false
  }
}

/** The browser preflight's verdict — the refusal carries the exact remedy. */
export type BrowserPreflight = { ok: true } | { ok: false; reason: string }

/**
 * Whether the browser the runner would launch is ready — `playwright-core`
 * installed AND its Chromium binary present on this machine — with the refusal
 * reason when it is not. Judged ONCE per run by callers that are about to
 * spend on web executions: a missing browser fails every one of them
 * identically, so discovering it inside each is N copies of one machine fact.
 */
export async function preflightBrowser(): Promise<BrowserPreflight> {
  const loaded = await loadChromium()
  if (!loaded.ok) return { ok: false, reason: loaded.reason }
  if (!isBinaryPresent(loaded.chromium)) return { ok: false, reason: BROWSER_MISSING_MESSAGE }
  return { ok: true }
}

/**
 * True when the browser the runner would launch is ready — `playwright-core`
 * installed AND its Chromium binary present on this machine.
 */
export async function isBrowserInstalled(): Promise<boolean> {
  return (await preflightBrowser()).ok
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
  const loaded = await loadChromium()
  if (!loaded.ok) return { ok: false, reason: loaded.reason }
  const chromium = loaded.chromium
  if (!isBinaryPresent(chromium)) return { ok: false, reason: BROWSER_MISSING_MESSAGE }
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
      // The page must render the same on every machine: scenarios assert rendered
      // clock labels, so the browser's timezone and locale are pinned to the same
      // UTC/C-locale world the CLI driver's child env pins (child-env.ts).
      timezoneId: 'UTC',
      locale: 'en-US',
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

  // THE file-chooser channel. The listener is permanent because interception is:
  // attaching one per step would race the click that opens the dialog (and, with
  // no listener at all, Chromium shows a native dialog nothing can answer). A
  // chooser that arrives unwaited-for is PARKED for the step that armed itself and
  // then clicked; a chooser nobody ever asked for is dropped at the next arming.
  let parked: FileChooser | null = null
  let waiting: ((chooser: FileChooser) => void) | null = null
  page.on('filechooser', (chooser) => {
    if (waiting) {
      const resume = waiting
      waiting = null
      resume(chooser)
    } else {
      parked = chooser
    }
  })
  const armFileChooser = (): ArmedFileChooser => {
    parked = null
    waiting = null
    return {
      next(timeoutMs: number): Promise<FileChooser | null> {
        // The click may already have opened it: `arm` → `click` → `next` is the
        // order the executor drives, and the event lands in between.
        if (parked) {
          const chooser = parked
          parked = null
          return Promise.resolve(chooser)
        }
        return new Promise<FileChooser | null>((resolve) => {
          const timer = setTimeout(() => {
            waiting = null
            // No chooser is a real answer about the page: the control took the
            // click and asked for no file. The caller reports it as such.
            resolve(null)
          }, Math.max(1, timeoutMs))
          waiting = (chooser) => {
            clearTimeout(timer)
            resolve(chooser)
          }
        })
      },
    }
  }

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
      armFileChooser,
      close,
    },
  }
}
