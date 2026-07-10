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

export function armChildKill(
  child: Pick<ChildProcess, 'kill' | 'pid'>,
  timeoutMs: number,
  signal?: AbortSignal,
): ChildKillControls {
  // A failed spawn (e.g. ENOENT) has no pid; `kill()` would then signal pid 0 —
  // the WHOLE process group, host included. Never signal a child that never ran.
  const kill = (): void => {
    if (child.pid !== undefined) child.kill('SIGKILL')
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
