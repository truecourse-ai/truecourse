/**
 * THE SANDBOX'S SERVED SURFACE — one server, shared by every driver that talks to it.
 *
 * The sandbox is ONE WORLD (§2, 2026-08-09), and a world has one address. A browser
 * step drives the served app and a `request` step reads the same app's structured
 * answer, so both must reach the SAME origin: two lazily-booted servers would be two
 * worlds wearing one scenario's name, and a request would read state the page never
 * had.
 *
 * Started LAZILY, at the first step that needs it — the surface serves the sandbox,
 * so the cli steps ahead of it must have populated what it will serve. Started ONCE,
 * whichever driver gets there first. Torn down after every driver has closed (the
 * browser must go first, or a page still talking to a killed server fills the
 * evidence with connection errors).
 *
 * Failure is INFRASTRUCTURE, returned and never thrown: a surface that will not boot
 * means nothing about the app was observed. It is not memoized — a scenario whose
 * surface failed at step 2 may legitimately have a step 5 that tries again.
 */

import type { ResolvedWebSurface } from '../recipe.js'
import { startWebSurface, type WebSurfaceHandle } from '../web/surface.js'
import type { StepRunContext } from './types.js'
import { WEB_SURFACE_DOWN_PREFIX } from '../world-health.js'

/** What a driver needs from the run to bring the surface up: the world it serves. */
export type SurfaceOpenContext = Pick<StepRunContext, 'repoRoot' | 'sandbox' | 'signal'>

export type OpenSurfaceResult =
  | { ok: true; server: WebSurfaceHandle }
  | {
      ok: false
      /** One-line reason, in the words the scenario's `error` will carry. */
      reason: string
    }

export interface SandboxSurface {
  /**
   * True when the recipe declares a web surface at all. Each driver words its own
   * error for a repo that declares none — a browser with nothing to point at and a
   * request with nowhere to go are the same missing recipe block, said to different
   * readers.
   */
  readonly declared: boolean
  /** The running server, started on first use. */
  open(ctx: SurfaceOpenContext): Promise<OpenSurfaceResult>
  /** The started server, or null when nothing has started it yet. */
  current(): WebSurfaceHandle | null
  /** Drain and kill the server's process group, if one came up. Idempotent. */
  close(): Promise<void>
}

/** The one served surface of ONE scenario. */
export function sandboxSurface(surface: ResolvedWebSurface | null): SandboxSurface {
  let server: WebSurfaceHandle | null = null

  return {
    declared: surface !== null,
    current: () => server,

    async open(ctx) {
      if (server) return { ok: true, server }
      if (!surface) return { ok: false, reason: 'the recipe declares no `web` block' }
      const started = await startWebSurface({
        surface,
        repoRoot: ctx.repoRoot,
        sandboxCwd: ctx.sandbox.cwd,
        sandboxEnv: ctx.sandbox.env,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      })
      if (!started.ok) return { ok: false, reason: `${WEB_SURFACE_DOWN_PREFIX}${started.reason}` }
      server = started.server
      return { ok: true, server }
    },

    async close() {
      if (!server) return
      const running = server
      server = null
      await running.drain()
      await running.stop()
    },
  }
}
