/**
 * Step executor — spawn the entrypoint + argv in the sandbox, feed stdin, capture
 * raw stdout/stderr/exit, and enforce a hard per-step timeout. A timeout, a spawn
 * failure, or stdio that outlives the process is an infrastructure problem (mapped
 * to the `error` outcome upstream), never a scenario `fail`. Zero retries by design.
 *
 * The step settles on `close` or `error` — never on the child's `exit` alone. A
 * process the step spawned can inherit the pipes and hold `close` open for as long
 * as it lives; what bounds that wait is the step's OWN timeout, whose group SIGKILL
 * reaps the holder and closes the pipes, so `close` always arrives. There is
 * deliberately no short grace after `exit`: a helper merely slow to let go (a
 * telemetry flush, a postinstall, `sh -c 'cmd | tee'`) is indistinguishable from a
 * daemon until it lets go, so any constant would classify healthy steps by machine
 * load. Spending an anomalous step's own budget is the accepted price.
 */

import { spawn } from 'node:child_process'
import { armChildKill } from './child-kill.js'

export const DEFAULT_STEP_TIMEOUT_MS = 30_000

/**
 * Safety valve, NOT a drain window: how long after the timeout SIGKILL the step
 * still waits for the `close` that kill should have produced. It classifies
 * nothing — by the time it can run, the outcome is already decided — so unlike the
 * drain grace it replaces (deleted: a constant racing machine load, which reported
 * healthy short-lived helpers as infrastructure failures) it cannot be wrong about
 * a step, only late.
 *
 * It exists because `armChildKill`'s group kill falls back to `child.kill()` when
 * `process.kill(-pid, …)` throws, and on a child that has already exited that
 * fallback is a no-op: the orphan keeps the pipes, `close` never fires, and the run
 * hangs. This bounds that narrow door.
 */
export const POST_KILL_SETTLE_GRACE_MS = 1_000

export interface StepCapture {
  exitCode: number | null
  /** Non-null when the process was killed by a signal (e.g. the timeout SIGKILL). */
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  /**
   * The COMMAND itself never returned inside the step budget. Mutually exclusive
   * with {@link orphanedStdio}: a command that finished did not time out, whatever
   * its leftovers did, and saying both would make one of the two fields a lie.
   */
  timedOut: boolean
  /** Present when the process could not be spawned at all (e.g. command not found). */
  spawnError?: string
  /**
   * The process ended on its own, but its stdio was still open when the step budget
   * ran out — a background process it spawned holds the pipes. The capture is
   * whatever had arrived by then, and that process group has been SIGKILLed.
   */
  orphanedStdio?: boolean
  durationMs: number
}

export interface ExecuteStepOptions {
  argv: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  stdin?: string
  timeoutMs?: number
  /** Run-level cancellation: SIGKILLs the child, same path as the step timer. */
  signal?: AbortSignal
}

export function executeStep(opts: ExecuteStepOptions): Promise<StepCapture> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS
  const [command, ...args] = opts.argv
  const start = Date.now()

  // Already-cancelled callers never spawn anything (same rule as runBuild).
  if (opts.signal?.aborted) {
    return Promise.resolve({
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      durationMs: 0,
    })
  }

  return new Promise<StepCapture>((resolve) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      // Group-lead the child (POSIX) so the kill below reaches processes IT
      // spawned — a step that starts a daemon would otherwise leave it running.
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    /**
     * The child's own exit status, recorded ONLY when it exited before the kill
     * timer fired. That is what separates the two anomalies at settle time: with a
     * status, the command finished and merely its stdio kept us waiting
     * (`orphanedStdio`); without one, the command itself overran (`timedOut`).
     * `exit` fires for a SIGKILLed child too, so the event alone can't tell them
     * apart — the moment it arrived is the whole discriminator.
     *
     * An ABORT is deliberately outside that split: it leaves `timedOut` false, so a
     * child the abort killed is recorded here and settles with neither flag — a
     * capture that reads clean for a step that was cancelled. That is fine because
     * a cancelled capture is never a verdict: the only caller that passes a signal
     * (`run-scenario`) re-checks `signal.aborted` and returns `abortedResult`
     * BEFORE it looks at either flag. Give this value a meaning and it would have
     * to be a third outcome nobody reads.
     */
    let exitedOnItsOwn: { code: number | null; signal: NodeJS.Signals | null } | undefined
    let backstop: NodeJS.Timeout | undefined
    // The group id, captured at spawn: it is the child's pid, and reading it back
    // off a child the runtime has already reaped is not something to depend on.
    const pgid = child.pid

    // `groupOutlivesChild`: a daemon the command left behind keeps this group alive
    // after the child exits, and the CLI's death sweep is the only thing that can
    // reap it if a Ctrl-C lands before the step settles. `finish` disarms, which is
    // where the enrolment ends — after the orphan reap below, never before it.
    const kill = armChildKill(child, timeoutMs, opts.signal, {
      processGroup: true,
      groupOutlivesChild: true,
    })

    const finish = (capture: StepCapture): void => {
      if (settled) return
      settled = true
      kill.disarm()
      if (backstop) clearTimeout(backstop)
      // Drop our read ends: a process still holding the write ends would
      // otherwise keep these handles on the event loop after the step settled.
      child.stdout.destroy()
      child.stderr.destroy()
      resolve(capture)
    }

    /** The settle shared by `close` and the post-kill backstop. */
    const finishAfterExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      const orphaned = kill.timedOut ? exitedOnItsOwn : undefined
      // Last word on the one settle where something of the step's can still be
      // running. Normally a no-op (ESRCH): `armChildKill`'s timeout already group
      // killed, which is what produced the `close` that got us here. It matters on
      // the backstop path, where that kill can have thrown and its `child.kill()`
      // fallback done nothing — an already-exited child is not killable, and the
      // death sweep deregistered the pid at that same exit, so this is the only
      // reap left. NOT covered by a test: the only group-kill failure a test can
      // provoke is ESRCH, which means the group is empty and there is nothing to
      // reap either way (an orphan that setsid'd into its own group escapes both
      // kills — `settles at the backstop when the orphan escaped the process
      // group` pins that the STEP still settles, not that the escapee dies).
      if (orphaned && pgid !== undefined && process.platform !== 'win32') {
        try {
          process.kill(-pgid, 'SIGKILL')
        } catch {
          // Group already gone (ESRCH) — nothing to reap.
        }
      }
      finish({
        // An orphan's step reports the command's OWN outcome; the SIGKILL that
        // freed the pipes is ours, not the step's, and must not surface as one.
        exitCode: orphaned ? orphaned.code : code,
        signal: orphaned ? orphaned.signal : signal,
        stdout,
        stderr,
        timedOut: kill.timedOut && orphaned === undefined,
        ...(orphaned ? { orphanedStdio: true } : {}),
        durationMs: Date.now() - start,
      })
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8')
    })

    child.on('error', (err) => {
      finish({
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        timedOut: kill.timedOut,
        spawnError: err.message,
        durationMs: Date.now() - start,
      })
    })

    // The ONLY settle for a child that ran: it waits for stdio EOF, which the
    // timeout's group kill guarantees even when a process the step spawned is the
    // one holding the pipes. That kill is also what reaps such a process — the
    // death sweep can't, having deregistered the pid when the DIRECT child exited,
    // which is the very moment its daemon became an orphan.
    child.on('close', finishAfterExit)

    child.on('exit', (code, signal) => {
      if (!kill.timedOut) exitedOnItsOwn = { code, signal }
      // From here on `close` waits on a process we do not control, so arm the
      // backstop: the remaining budget (after which the group kill runs) plus the
      // grace that kill needs to produce the `close` we are waiting for.
      const remaining = Math.max(0, timeoutMs - (Date.now() - start))
      backstop = setTimeout(() => finishAfterExit(code, signal), remaining + POST_KILL_SETTLE_GRACE_MS)
      backstop.unref()
    })

    if (opts.stdin !== undefined) child.stdin.write(opts.stdin)
    child.stdin.end()
  })
}
