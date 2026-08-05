/**
 * Step executor — spawn the entrypoint + argv in the sandbox, feed stdin, capture
 * raw stdout/stderr/exit, and enforce a hard per-step timeout. A timeout, a spawn
 * failure, or stdio that outlives the process is an infrastructure problem (mapped
 * to the `error` outcome upstream), never a scenario `fail`. Zero retries by design.
 *
 * The step settles on the FIRST of `close`, `exit` + a drain grace, or `error`: a
 * process the step spawned can inherit the pipes and hold `close` open for as long
 * as it lives, and a step that never settles hangs the whole run.
 */

import { spawn } from 'node:child_process'
import { armChildKill } from './child-kill.js'

export const DEFAULT_STEP_TIMEOUT_MS = 30_000

/**
 * How long after the child's own exit its stdio is still allowed to reach EOF.
 * A process the child spawned with inherited stdio holds the pipe write ends, so
 * `close` may never fire; the step settles on `exit` + this window instead.
 */
export const STDIO_DRAIN_GRACE_MS = 1_000

export interface StepCapture {
  exitCode: number | null
  /** Non-null when the process was killed by a signal (e.g. the timeout SIGKILL). */
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
  /** Present when the process could not be spawned at all (e.g. command not found). */
  spawnError?: string
  /**
   * The process ended but its stdio stayed open past {@link STDIO_DRAIN_GRACE_MS}
   * — a background process it spawned still holds the pipes. The capture is
   * whatever had arrived by then.
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

    const kill = armChildKill(child, timeoutMs, opts.signal, { processGroup: true })

    const finish = (capture: StepCapture): void => {
      if (settled) return
      settled = true
      kill.disarm()
      // Drop our read ends: a process still holding the write ends would
      // otherwise keep these handles on the event loop after the step settled.
      child.stdout.destroy()
      child.stderr.destroy()
      resolve(capture)
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

    child.on('close', (code, signal) => {
      finish({
        exitCode: code,
        signal,
        stdout,
        stderr,
        timedOut: kill.timedOut,
        durationMs: Date.now() - start,
      })
    })

    // `close` is the fast path (it waits for stdio EOF) and wins this race
    // whenever the pipes actually close; the grace settles the step when they
    // never do, because something the child spawned inherited them.
    child.on('exit', (code, signal) => {
      setTimeout(() => {
        finish({
          exitCode: code,
          signal,
          stdout,
          stderr,
          timedOut: kill.timedOut,
          orphanedStdio: true,
          durationMs: Date.now() - start,
        })
      }, STDIO_DRAIN_GRACE_MS).unref()
    })

    if (opts.stdin !== undefined) child.stdin.write(opts.stdin)
    child.stdin.end()
  })
}
