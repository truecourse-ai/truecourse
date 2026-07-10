/**
 * Step executor — spawn the entrypoint + argv in the sandbox, feed stdin, capture
 * raw stdout/stderr/exit, and enforce a hard per-step timeout. A timeout or a
 * spawn failure is an infrastructure problem (mapped to the `error` outcome
 * upstream), never a scenario `fail`. Zero retries by design.
 */

import { spawn } from 'node:child_process'
import { armChildKill } from './child-kill.js'

export const DEFAULT_STEP_TIMEOUT_MS = 30_000

export interface StepCapture {
  exitCode: number | null
  /** Non-null when the process was killed by a signal (e.g. the timeout SIGKILL). */
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
  /** Present when the process could not be spawned at all (e.g. command not found). */
  spawnError?: string
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
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const kill = armChildKill(child, timeoutMs, opts.signal)

    const finish = (capture: StepCapture): void => {
      if (settled) return
      settled = true
      kill.disarm()
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

    if (opts.stdin !== undefined) child.stdin.write(opts.stdin)
    child.stdin.end()
  })
}
