/**
 * Shared kill controls for a spawned guard child (`runBuild`, `executeStep`): a
 * hard-timeout timer plus an external-abort listener, both SIGKILL. The timer
 * marks `timedOut`; an abort leaves it false, so a cancelled run stays
 * distinguishable from a child that overran its own budget. Callers short-circuit
 * a pre-aborted signal BEFORE spawning (never spawn just to kill) and `disarm()`
 * when the child settles.
 */

import type { ChildProcess } from 'node:child_process'

export interface ChildKillControls {
  /** True once the timeout timer fired (and SIGKILLed the child). */
  readonly timedOut: boolean
  /** Cancel the timer and detach the abort listener (call on settle). */
  disarm(): void
}

export interface ChildKillOptions {
  /**
   * SIGKILL the child's whole process group (POSIX only), not just the direct
   * child. Required whenever the child can have descendants of its own: a
   * `shell: true` spawn where the shell forks the command instead of exec-ing it
   * (dash on Linux does), or a step that starts a daemon. Killing the direct
   * child alone leaves those holding the stdio pipes — `close` never fires. The
   * caller must have spawned with `detached: true` so the child leads its own
   * group and `kill(-pid)` cannot reach the host's group.
   */
  processGroup?: boolean
}

export function armChildKill(
  child: Pick<ChildProcess, 'kill' | 'pid'>,
  timeoutMs: number,
  signal?: AbortSignal,
  options?: ChildKillOptions,
): ChildKillControls {
  // A failed spawn (e.g. ENOENT) has no pid; `kill()` would then signal pid 0 —
  // the WHOLE process group, host included. Never signal a child that never ran.
  const kill = (): void => {
    if (child.pid === undefined) return
    if (options?.processGroup && process.platform !== 'win32') {
      try {
        process.kill(-child.pid, 'SIGKILL')
        return
      } catch {
        // Group already gone (ESRCH) or not a group leader — fall through.
      }
    }
    child.kill('SIGKILL')
  }

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    kill()
  }, timeoutMs)

  signal?.addEventListener('abort', kill, { once: true })

  return {
    get timedOut() {
      return timedOut
    },
    disarm() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', kill)
    },
  }
}
