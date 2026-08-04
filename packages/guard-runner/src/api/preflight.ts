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
  /**
   * Working directory the server boots in. Absent ⇒ the throwaway sandbox (the
   * default every recipe had). Callers pass the repo root when the recipe says
   * `api.cwd: "repo"` — a workspace-mediated serve argv cannot run anywhere else.
   */
  cwd?: string
  healthPath: string
  readyTimeoutMs: number
  /**
   * The recipe server NAME this boot is proving. When set, a failure's
   * `stderr` opens with `server "<label>": ` — with several servers preflighted in
   * turn, the one loud error must say WHICH one would not start. Absent (every
   * single-server recipe) the message is byte-identical to what it always was.
   */
  label?: string
  signal?: AbortSignal
  /**
   * Run-level work that needs a LIVE app, executed once the server is healthy and
   * before it is stopped — today the `fromRequest` credential logins,
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
      cwd: opts.cwd ?? sandbox.cwd,
      env: sandbox.env,
      healthPath: opts.healthPath,
      readyTimeoutMs: opts.readyTimeoutMs,
      signal: opts.signal,
    })
    if (!boot.ok) {
      const output = [boot.stderr.trim(), boot.stdout.trim()].filter(Boolean).join('\n')
      const reason = opts.label ? `server "${opts.label}": ${boot.reason}` : boot.reason
      return {
        ok: false,
        // A server that never turns healthy is the api analogue of a CRASHED entry:
        // it did not come up. The silent gate is cli-only (there is no argv to vary).
        kind: 'crash',
        entry,
        stderr: output ? `${reason}\n${output}` : reason,
        probes: [],
      }
    }
    try {
      await opts.onReady?.(boot.server.baseUrl)
    } finally {
      await boot.server.stop()
    }
    return { ok: true, kind: 'ok', entry, stderr: '', probes: [] }
  } finally {
    sandbox.cleanup()
  }
}
