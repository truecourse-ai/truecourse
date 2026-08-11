/**
 * The scenario's WEB WORLD: the served surface plus the browser driving it, opened
 * LAZILY at the first web step and torn down with the sandbox.
 *
 * Lazily, because a mixed scenario's cli steps must run FIRST and their effects must
 * be there when the surface starts: the surface serves the sandbox, so a `truecourse
 * analyze` step earlier in the list is what the browser then sees. Booting the
 * surface up front would serve an empty world and make that chain untestable.
 *
 * Torn down with the sandbox, unconditionally: the server is killed as a process
 * GROUP (the api driver's `stop`, so a serve command that shells out leaves nothing
 * behind) and the browser's context and process are closed. Nothing here outlives a
 * scenario, whichever way the scenario ended.
 */

import fs from 'node:fs'
import type { Page } from 'playwright-core'
import type { ResolvedWebSurface } from '../recipe.js'
import { launchWebBrowser, type WebBrowserHandle } from './browser.js'
import { startWebSurface, type WebSurfaceHandle } from './surface.js'

export interface OpenWebSessionOptions {
  surface: ResolvedWebSurface
  repoRoot: string
  sandboxCwd: string
  sandboxEnv: NodeJS.ProcessEnv
  /** Absolute directory screenshots and the session video are written into. */
  evidenceDir: string
  signal?: AbortSignal
}

export interface WebSession {
  /** The one page every web step of this scenario acts on. */
  page: Page
  /** `http://127.0.0.1:<port>` — what a `navigate` path is appended to. */
  baseUrl: string
  /** The served surface, for the caller that wants its captured output. */
  server: WebSurfaceHandle
  browser: WebBrowserHandle
  /** Everything the page logged and every uncaught page error, in order. */
  consoleLines(): readonly string[]
  /** Close the browser and kill the server's process group. Idempotent. */
  close(): Promise<{ video: string | null }>
}

export type OpenWebSessionResult =
  | { ok: true; session: WebSession }
  | {
      ok: false
      /** One-line reason, in the words the scenario's `error` will carry. */
      reason: string
      /** What the surface printed before it gave up, when it printed anything. */
      stdout?: string
      stderr?: string
    }

/**
 * Boot the web surface, launch the browser, and hand back the page. Every failure
 * is INFRASTRUCTURE — no page ever existed to assert against — so it is returned,
 * never thrown, and whatever did come up is torn down before returning.
 */
export async function openWebSession(opts: OpenWebSessionOptions): Promise<OpenWebSessionResult> {
  fs.mkdirSync(opts.evidenceDir, { recursive: true })

  const started = await startWebSurface({
    surface: opts.surface,
    repoRoot: opts.repoRoot,
    sandboxCwd: opts.sandboxCwd,
    sandboxEnv: opts.sandboxEnv,
    ...(opts.signal ? { signal: opts.signal } : {}),
  })
  if (!started.ok) {
    return {
      ok: false,
      reason: `the web surface did not come up: ${started.reason}`,
      ...(started.stdout ? { stdout: started.stdout } : {}),
      ...(started.stderr ? { stderr: started.stderr } : {}),
    }
  }
  const server = started.server

  const launched = await launchWebBrowser({ videoDir: opts.evidenceDir })
  if (!launched.ok) {
    // The surface is already serving; a browser that cannot launch must not leave
    // it behind. One failure, one teardown.
    await server.stop()
    return { ok: false, reason: launched.reason }
  }
  const browser = launched.browser

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
      async close() {
        if (closed) return { video }
        closed = true
        // The browser first: a page still talking to a server that has just been
        // killed produces a stream of connection errors in the evidence.
        video = await browser.close()
        await server.drain()
        await server.stop()
        return { video }
      },
    },
  }
}
