/**
 * Pseudo-terminal execution — the `tty: true` step.
 *
 * A command that ASKS A QUESTION only asks it on a terminal: every well-behaved
 * CLI checks `isTTY` and refuses (or picks a default) when its stdin is a pipe, so
 * the whole interactive half of a program — a confirmation, a stash decision, a
 * scripted wizard — is unreachable through `child_process` pipes. There is no env
 * variable that makes a pipe a terminal; a program that trusted one would be
 * broken. The only honest mechanism is to give the child a REAL pty, which is what
 * this module does, through `@lydell/node-pty` (prebuilt binaries for every
 * platform we run on — no compiler at install time).
 *
 * Two properties of a terminal are inherent, not choices we make:
 *  - ONE output channel. A pty carries stdout and stderr on the same stream, so
 *    the capture reports everything as `stdout` and leaves `stderr` empty. Assert
 *    with `expect.output` (or `expect.stdout`), never `expect.stderr`.
 *  - ECHO. What the scripted `stdin` types is echoed back by the line discipline,
 *    exactly as it appears in a real session, so it is part of the transcript.
 *
 * The one thing that IS undone is the line discipline's own `\n` → `\r\n`
 * translation (ONLCR): the program wrote `\n`, the terminal added the `\r`, and an
 * assertion is about what the program printed — so the same matcher must hold
 * whether the step ran on a pty or on pipes. A BARE `\r` is left alone: a progress
 * bar rewriting its line is the program's own output, not the terminal's doing.
 *
 * The pty is loaded LAZILY and its absence is reported, never worked around: a
 * `tty` step on a platform with no pty binary settles as an infrastructure error
 * naming the missing module, so nobody gets a green from a prompt that was never
 * shown.
 */

import type { StepCapture, ExecuteStepOptions } from './executor.js'
import { DEFAULT_STEP_TIMEOUT_MS } from './executor.js'
import { DETERMINISM_PINS } from './child-env.js'

/** The terminal the child is told it is on — dumb enough to keep output plain. */
const PTY_TERM = 'xterm-256color'
/** Terminal geometry, pinned like every other determinism input (`COLUMNS`). */
const PTY_COLS = Number(DETERMINISM_PINS.COLUMNS ?? 80)
const PTY_ROWS = 24

/** The minimal surface of `@lydell/node-pty` this module uses. */
interface PtyModule {
  spawn(
    file: string,
    args: string[],
    options: {
      name: string
      cols: number
      rows: number
      cwd: string
      env: Record<string, string>
    },
  ): PtyProcess
}

interface PtyProcess {
  onData(listener: (data: string) => void): void
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): void
  write(data: string): void
  kill(signal?: string): void
}

let ptyModule: Promise<PtyModule> | null = null

/** Load the pty binding once per process; the rejection is re-thrown per step. */
function loadPty(): Promise<PtyModule> {
  ptyModule ??= import('@lydell/node-pty').then((m) => (m.default ?? m) as unknown as PtyModule)
  return ptyModule
}

/** The env a pty child gets: the step's env, string-valued, with `TERM` set. */
function ptyEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) out[key] = value
  }
  out.TERM = PTY_TERM
  return out
}

/**
 * Run one step on a pseudo-terminal. Same contract as `executeStep`: it always
 * resolves with a capture, never throws — a missing pty binding, a spawn failure
 * and a timeout all arrive as recorded facts about the step.
 */
export function executeTtyStep(opts: ExecuteStepOptions): Promise<StepCapture> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS
  const [command, ...args] = opts.argv
  const start = Date.now()

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

  return loadPty().then(
    (pty) =>
      new Promise<StepCapture>((resolve) => {
        let child: PtyProcess
        try {
          child = pty.spawn(command, args, {
            name: PTY_TERM,
            cols: PTY_COLS,
            rows: PTY_ROWS,
            cwd: opts.cwd,
            env: ptyEnv(opts.env),
          })
        } catch (e) {
          resolve({
            exitCode: null,
            signal: null,
            stdout: '',
            stderr: '',
            timedOut: false,
            spawnError: e instanceof Error ? e.message : String(e),
            durationMs: Date.now() - start,
          })
          return
        }

        let output = ''
        let settled = false
        let timedOut = false
        let timer: NodeJS.Timeout | undefined
        const onAbort = (): void => kill()

        const kill = (): void => {
          try {
            child.kill('SIGKILL')
          } catch {
            // Already gone — the exit handler settles the step.
          }
        }

        const finish = (capture: StepCapture): void => {
          if (settled) return
          settled = true
          if (timer) clearTimeout(timer)
          opts.signal?.removeEventListener('abort', onAbort)
          resolve(capture)
        }

        timer = setTimeout(() => {
          timedOut = true
          kill()
        }, timeoutMs)
        timer.unref()
        opts.signal?.addEventListener('abort', onAbort, { once: true })

        child.onData((data) => {
          output += data
        })

        child.onExit(({ exitCode, signal }) => {
          finish({
            exitCode: timedOut ? null : exitCode,
            // node-pty reports the signal NUMBER; the capture's field is the name,
            // and the only signal we ever send is the timeout kill.
            signal: timedOut || signal ? 'SIGKILL' : null,
            // A terminal has one channel: everything the child wrote is here, with
            // the line discipline's `\r\n` folded back to the `\n` the program sent.
            stdout: output.replaceAll('\r\n', '\n'),
            stderr: '',
            timedOut,
            durationMs: Date.now() - start,
          })
        })

        if (opts.stdin !== undefined) child.write(opts.stdin)
      }),
    (e) =>
      ({
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        spawnError: `a tty step needs a pseudo-terminal, and @lydell/node-pty could not be loaded: ${
          e instanceof Error ? e.message : String(e)
        }`,
        durationMs: Date.now() - start,
      }) satisfies StepCapture,
  )
}
