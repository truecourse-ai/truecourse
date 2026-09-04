/**
 * The scenario's BROWSER, pointed at the sandbox's served surface — opened LAZILY at
 * the first web step and closed with the scenario.
 *
 * Lazily, because a mixed scenario's cli steps must run FIRST and their effects must
 * be there when the browser looks: the surface serves the sandbox, so a `truecourse
 * analyze` step earlier in the list is what the browser then sees.
 *
 * The SERVER is not this module's: it belongs to the sandbox (`drivers/surface.ts`),
 * because a `request` step reads the same origin the browser drives and one world has
 * one address. A session therefore takes an already-running server and closes only
 * what it opened — the browser — which is also the right ORDER: the surface goes down
 * after the page that was talking to it, or the evidence fills with connection errors.
 */

import fs from 'node:fs'
import type { Page } from 'playwright-core'
import { launchWebBrowser, type ArmedFileChooser, type WebBrowserHandle } from './browser.js'
import type { WebSurfaceHandle } from './surface.js'

export interface OpenWebSessionOptions {
  /** The sandbox's running served surface — started by, and owned by, the sandbox. */
  server: WebSurfaceHandle
  /** Absolute directory screenshots and the session video are written into. */
  evidenceDir: string
}

export interface WebSession {
  /** The one page every web step of this scenario acts on. */
  page: Page
  /** `http://127.0.0.1:<port>` — what a `navigate` path is appended to. */
  baseUrl: string
  /** The served surface this session drives (the sandbox's, not the session's). */
  server: WebSurfaceHandle
  browser: WebBrowserHandle
  /** Everything the page logged and every uncaught page error, in order. */
  consoleLines(): readonly string[]
  /**
   * Arm the page for the next file chooser — the session's, because the listener
   * that intercepts them belongs to the page and lives as long as it does. See
   * {@link WebBrowserHandle.armFileChooser} for why it is armed per step.
   */
  armFileChooser(): ArmedFileChooser
  /** Close the browser. Idempotent; the server outlives it and is the sandbox's. */
  close(): Promise<{ video: string | null }>
}

export type OpenWebSessionResult =
  | { ok: true; session: WebSession }
  | {
      ok: false
      /** One-line reason, in the words the scenario's `error` will carry. */
      reason: string
    }

/**
 * Launch the browser against the sandbox's running surface and hand back the page.
 * A browser that cannot launch is INFRASTRUCTURE — no page ever existed to assert
 * against — so it is returned, never thrown. The surface is left exactly as found:
 * it is the sandbox's, and a request step may still be using it.
 */
export async function openWebSession(opts: OpenWebSessionOptions): Promise<OpenWebSessionResult> {
  fs.mkdirSync(opts.evidenceDir, { recursive: true })

  const launched = await launchWebBrowser({ videoDir: opts.evidenceDir })
  if (!launched.ok) return { ok: false, reason: launched.reason }
  const browser = launched.browser
  const server = opts.server

  let closed = false
  let video: string | null = null

  return {
    ok: true,
    session: {
      page: browser.page,
      baseUrl: server.baseUrl,
      server,
      browser,
      consoleLines: () => [...browser.consoleLines(), ...browser.pageErrors().map((e) => `pageerror: ${e}`)],
      armFileChooser: () => browser.armFileChooser(),
      async close() {
        if (closed) return { video }
        closed = true
        video = await browser.close()
        return { video }
      },
    },
  }
}
