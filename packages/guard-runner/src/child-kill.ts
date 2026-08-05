/**
 * Shared kill controls for a spawned guard child (`runBuild`, `executeStep`): a
 * hard-timeout timer plus an external-abort listener, both SIGKILL. The timer
 * marks `timedOut`; an abort leaves it false, so a cancelled run stays
 * distinguishable from a child that overran its own budget. Callers short-circuit
 * a pre-aborted signal BEFORE spawning (never spawn just to kill) and `disarm()`
 * when the child settles.
 *
 * Both timers live in THIS process, and a group-led child runs outside the
 * terminal's foreground group — so the module also sweeps every live group on the
 * way down (Ctrl-C, SIGTERM, terminal close, `process.exit`); otherwise a killed
 * CLI leaves the running step and whatever it spawned with nobody left to kill it.
 */

import type { ChildProcess } from 'node:child_process'

/** Pids of live children leading their own process group (POSIX only). */
const groupLeaders = new Set<number>()
let sweepArmed = false

/** SIGKILL every live group. Synchronous, so it is safe from a signal handler. */
function sweepGroups(): void {
  for (const pid of groupLeaders) {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      // Group already gone (ESRCH) — nothing to reap.
    }
  }
  groupLeaders.clear()
}

const SWEEP_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP']

/** Install the process-death sweep once, on the first group-led child. */
function armSweep(): void {
  if (sweepArmed) return
  sweepArmed = true
  // Covers every `process.exit()` path, including another listener's own exit.
  process.on('exit', sweepGroups)
  for (const sig of SWEEP_SIGNALS) {
    const onSignal = (): void => {
      sweepGroups()
      // Never swallow the signal. Dropping our listener restores the default
      // disposition, so re-raising kills us with the conventional status (130 for
      // SIGINT); any other listener owns its own exit, so it decides instead.
      process.removeListener(sig, onSignal)
      if (process.listenerCount(sig) === 0) process.kill(process.pid, sig)
    }
    process.on(sig, onSignal)
  }
}

/**
 * Enrol a child that leads its own process group in the death sweep. No-op off
 * POSIX and for a child that never spawned (no pid). Its own `exit` deregisters it
 * — the only safe point, since a stale pid would later signal whatever the OS
 * recycled it into. Idempotent per pid, and independent of how the caller kills:
 * {@link armChildKill} enrols the children it owns, and a caller with its own kill
 * path (the api server's `stop`) calls this directly.
 */
export function trackProcessGroup(child: Pick<ChildProcess, 'pid' | 'once'>): void {
  if (process.platform === 'win32' || child.pid === undefined) return
  const pid = child.pid
  groupLeaders.add(pid)
  armSweep()
  child.once('exit', () => groupLeaders.delete(pid))
}

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
  child: Pick<ChildProcess, 'kill' | 'pid' | 'once'>,
  timeoutMs: number,
  signal?: AbortSignal,
  options?: ChildKillOptions,
): ChildKillControls {
  const groupKill = options?.processGroup === true && process.platform !== 'win32'

  // A failed spawn (e.g. ENOENT) has no pid; `kill()` would then signal pid 0 —
  // the WHOLE process group, host included. Never signal a child that never ran.
  const kill = (): void => {
    if (child.pid === undefined) return
    if (groupKill) {
      try {
        process.kill(-child.pid, 'SIGKILL')
        return
      } catch {
        // Group already gone (ESRCH) or not a group leader — fall through.
      }
    }
    child.kill('SIGKILL')
  }

  // Deregistration keys off the child's exit, never `disarm()`: disarm runs when
  // the CALLER settles, which can be while the child is still alive.
  if (groupKill) trackProcessGroup(child)

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
