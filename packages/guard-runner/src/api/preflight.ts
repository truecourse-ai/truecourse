/**
 * Api preflight — before ANY api scenario (or birth candidate) boots the built
 * server, prove it can START and turn healthy once, in a throwaway sandbox. A
 * broken build, a missing module, or a server that never binds makes EVERY boot
 * fail identically; without this gate that surfaces as N indistinguishable
 * scenario errors. One loud server-level error instead — reported through the
 * SAME `entry-preflight-failed` result the cli driver uses (`entry` shows the
 * serve argv, `stderr` the server's startup output), so every consumer of that
 * status renders the api failure with zero new plumbing.
 */

import { createSandbox } from '../sandbox.js'
import type { EntryPreflightResult } from '../preflight.js'
import { startApiServer } from './server.js'

export interface ApiPreflightOptions {
  /** Absolute-resolved serve argv (see `resolveEntry`). */
  resolvedServe: string[]
  /** Display form of the serve argv (repo-relative, for the error message). */
  displayServe: readonly string[]
  /** Recipe-level env merged with the api block's env (api wins). */
  recipeEnv?: Record<string, string>
  healthPath: string
  readyTimeoutMs: number
  signal?: AbortSignal
  /**
   * Run-level work that needs a LIVE app, executed once the server is healthy and
   * before it is stopped — today the `fromRequest` credential logins (item 59b),
   * which must happen after a boot and must not pay for a second one. A rejection
   * propagates to the caller (the server is stopped and the sandbox cleaned up
   * first), so the caller maps it to its own loud run status.
   */
  onReady?: (baseUrl: string) => Promise<void>
}

/**
 * Boot the server once in a throwaway sandbox and wait for health, run any
 * `onReady` work against it, then stop it. Returns the cli preflight's result
 * shape so the ONE-loud-error paths are shared.
 */
export async function preflightApiServer(opts: ApiPreflightOptions): Promise<EntryPreflightResult> {
  const entry = opts.displayServe.join(' ')
  const sandbox = createSandbox({ recipeEnv: opts.recipeEnv })
  try {
    const boot = await startApiServer({
      resolvedServe: opts.resolvedServe,
      cwd: sandbox.cwd,
      env: sandbox.env,
      healthPath: opts.healthPath,
      readyTimeoutMs: opts.readyTimeoutMs,
      signal: opts.signal,
    })
    if (!boot.ok) {
      const output = [boot.stderr.trim(), boot.stdout.trim()].filter(Boolean).join('\n')
      return {
        ok: false,
        entry,
        stderr: output ? `${boot.reason}\n${output}` : boot.reason,
        probes: [],
      }
    }
    try {
      await opts.onReady?.(boot.server.baseUrl)
    } finally {
      await boot.server.stop()
    }
    return { ok: true, entry, stderr: '', probes: [] }
  } finally {
    sandbox.cleanup()
  }
}
