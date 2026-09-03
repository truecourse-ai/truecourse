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
 *
 * WHEN a pid leaves the set has two right answers, and which one applies is the
 * caller's to know:
 *
 * - Default, `deregisterOn: 'child-exit'` — the group dies with its leader, so the
 *   child's `exit` is the earliest moment the pid is provably free. Deregistering
 *   later would risk signalling a recycled pid; deregistering on the caller's
 *   settle would risk dropping a still-live group (the caller can settle while the
 *   child runs — `startApiServer` returns with its server up).
 * - `deregisterOn: 'manual'` — the GROUP outlives its leader. A step's command can
 *   return while a daemon it spawned holds the stdio, and there the child's `exit`
 *   is the exact moment the daemon becomes an orphan: pruning then hands the sweep
 *   an empty set when it has the most to do (a real Ctrl-C left a `relkit watch`
 *   daemon running — `signal-sweep.test.ts` pins it). `executeStep` holds the
 *   enrolment until the STEP settles, which is honest because by then it has
 *   already reaped the group itself on the orphan path.
 *
 * The sweep's tradeoff, deliberately taken: the set is keyed on pids, so a leader
 * whose deregistration never runs (an `exit` that was never delivered; a caller
 * that never settles) leaves a STALE pid behind, and the sweep would then SIGKILL
 * whatever the OS had recycled it into. The window is the tail of a dying CLI and
 * the target is a negative pid (a whole group). `manual` widens that window from
 * the child's exit to the step's settle, which stays acceptable for a bounded
 * reason: a step settles within its own timeout, and for the whole of the extra
 * window something of the step's is provably still holding the pipes — that is the
 * very condition that keeps the pgid allocated and un-recyclable.
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

export interface TrackProcessGroupOptions {
  /**
   * When the pid leaves the sweep set.
   *
   * - `child-exit` (default) — the child's own `exit`. Right whenever the group
   *   dies with its leader: the pid is provably free the instant the child is
   *   gone, so the set can never hold a stale one.
   * - `manual` — the returned untrack function, and nothing else. Required when
   *   the GROUP can outlive its leader: a step's command can return while a daemon
   *   it spawned holds the pipes, and deregistering at the child's exit hands the
   *   sweep an empty set at exactly the moment that daemon became an orphan (a
   *   real Ctrl-C left one running — the case `signal-sweep.test.ts` pins). The
   *   caller then owns the pid's staleness window; see the module doc.
   */
  deregisterOn?: 'child-exit' | 'manual'
}

/**
 * Enrol a child that leads its own process group in the death sweep, and return the
 * function that deregisters it. No-op off POSIX and for a child that never spawned
 * (no pid). Idempotent per pid, and independent of how the caller kills:
 * {@link armChildKill} enrols the children it owns, and a caller with its own kill
 * path (the api server's `stop`) calls this directly.
 */
export function trackProcessGroup(
  child: Pick<ChildProcess, 'pid' | 'once'>,
  options?: TrackProcessGroupOptions,
): () => void {
  if (process.platform === 'win32' || child.pid === undefined) return () => {}
  const pid = child.pid
  groupLeaders.add(pid)
  armSweep()
  const untrack = (): void => {
    groupLeaders.delete(pid)
  }
  if (options?.deregisterOn !== 'manual') child.once('exit', untrack)
  return untrack
}

export interface ChildKillControls {
  /** True once the timeout timer fired (and SIGKILLed the child). */
  readonly timedOut: boolean
  /**
   * Kill NOW, by the same path (and the same group reach) the timeout uses, without
   * marking the step as having overrun. For a caller that has its own reason to end
   * a child that would otherwise never end: a step declaring `until` stops its
   * command the moment the ready line appears, and that is a normal settle, not a
   * budget being spent.
   */
  now(): void
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
  /**
   * The group can outlive the direct child — a step whose command returns while a
   * daemon it spawned holds the stdio. Keeps the group enrolled in the death sweep
   * until `disarm()` instead of until the child's `exit`, so a Ctrl-C in that
   * window still has something to kill. Only for a caller whose settle is the
   * honest end of the group's life (the step executor, which reaps the group on
   * its orphan path before disarming); with `processGroup` only.
   */
  groupOutlivesChild?: boolean
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

  // Deregistration keys off the child's exit by default, NOT `disarm()`: disarm
  // runs when the CALLER settles, which can be while the child is still alive —
  // dropping a live group from the sweep is how a Ctrl-C ends up leaving it behind.
  // `groupOutlivesChild` inverts that for the caller whose group can survive its
  // leader, where the child's exit is the too-early point instead (see the option).
  const untrack = groupKill
    ? trackProcessGroup(child, options?.groupOutlivesChild === true ? { deregisterOn: 'manual' } : undefined)
    : undefined

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
    now: kill,
    disarm() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', kill)
      // Only under `groupOutlivesChild`; otherwise the child's own exit owns this.
      if (options?.groupOutlivesChild === true) untrack?.()
    },
  }
}
