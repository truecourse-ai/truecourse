/**
 * The SERVED half of the web driver: the web surface as a process.
 *
 * There is no new lifecycle here, deliberately. A web surface is a server that
 * answers HTTP on an allocated port and becomes ready when a path returns 2xx —
 * which is precisely what `api/server.ts` already spawns, port-substitutes,
 * health-polls, captures the output of, and kills as a process group. This module
 * is the ADAPTER from the recipe's `web` block to that machinery, and nothing
 * else: a second boot path would be a second set of bugs about zombie children.
 *
 * The surface runs in the SANDBOX (by default), which is the point of the whole
 * PoC: the sandbox is one world, so a cli step earlier in the scenario writes the
 * state that the surface then serves and the browser then sees.
 */

import { startApiServer, type ApiServerHandle, type StartApiServerResult } from '../api/server.js'
import { resolveEntry, type ResolvedWebSurface } from '../recipe.js'

export interface StartWebSurfaceOptions {
  surface: ResolvedWebSurface
  repoRoot: string
  /** The scenario sandbox's working directory — where a `cwd: sandbox` surface runs. */
  sandboxCwd: string
  /** The sandbox's constructed child env; the surface's own `env` layers over it. */
  sandboxEnv: NodeJS.ProcessEnv
  /** Run-level cancellation. */
  signal?: AbortSignal
}

export type { ApiServerHandle as WebSurfaceHandle }

/**
 * Boot the recipe's web surface and wait until it answers its readiness path with
 * 2xx. Every failure mode the api boot has is this boot's too, with its captured
 * output attached: a surface that exits at startup reports WHAT it printed.
 */
export function startWebSurface(opts: StartWebSurfaceOptions): Promise<StartApiServerResult> {
  return startApiServer({
    resolvedServe: resolveEntry(opts.repoRoot, opts.surface.serve),
    cwd: opts.surface.cwd === 'repo' ? opts.repoRoot : opts.sandboxCwd,
    // The surface's declared env wins over the sandbox's: `web.env` is the recipe
    // author saying what THIS process needs, and it already carries `recipe.env`
    // merged underneath it (see `resolveWebSurface`).
    env: { ...opts.sandboxEnv, ...opts.surface.env },
    healthPath: opts.surface.healthPath,
    readyTimeoutMs: opts.surface.readyTimeoutMs,
    ...(opts.signal ? { signal: opts.signal } : {}),
  })
}
