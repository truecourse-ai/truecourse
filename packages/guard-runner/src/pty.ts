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
 *  - ECHO. A canonical terminal echoes what is typed at it, so an answer a command
 *    reads as a LINE is part of the transcript. A prompt that reads KEYS has raw
 *    mode on and echoes nothing — both are exactly what a real session shows.
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
 *
 * SCRIPTED INPUT IS TYPED, NOT PRELOADED. A terminal answer is a reply, and it
 * only means what it says once the program is listening for keys: until a prompt
 * puts the terminal in raw mode the line discipline is still canonical, and
 * canonical input processing (`ICRNL`) rewrites the Enter keystroke — a CARRIAGE
 * RETURN, the only key a select prompt accepts as submit — into a newline before
 * the program ever reads it. Writing the whole script at spawn therefore answers
 * only the prompts that submit on a printable character (a `y`/`n` confirm) and
 * silently loses every select. So the script is delivered one answer at a time,
 * driven by what the child writes — in one of two disciplines, chosen by the form
 * the scenario scripted.
 *
 * PROMPT-KEYED ANSWERS (`stdin` as a list of `{marker, answer}`) are the
 * discipline for anything interactive: an answer is typed the moment ITS question
 * has appeared in the child's output, and never before. Timing decides nothing, so
 * a long non-prompt phase before the question — an LLM login preflight with a
 * spinner — changes nothing about when the answer lands. Markers are matched
 * against what the PROGRAM wrote (ANSI escapes stripped, `\r\n` folded), and in
 * SEQUENCE: each marker is looked for after the previous one's match, so two
 * questions worded alike are still two questions. When the child exits with an
 * answer still waiting, that marker is reported as {@link StepCapture.unaskedPrompt}
 * — the question was never asked, which is a finding about the dialogue, not a
 * wait to the step's timeout.
 *
 * A PLAIN STRING is the older, heuristic delivery, kept for scenarios written
 * before markers existed: the script is split into one answer per submit key and
 * each is typed on its own turn, driven by silence.
 *  - A turn opens when the child has produced output and then gone SILENT for
 *    {@link PROMPT_QUIET_MS} — a prompt renders itself and then waits, which is
 *    the shape of "your turn to type", and raw mode is usually on by then because
 *    a prompt enables it before it draws.
 *  - Turns come only from OUTPUT, so an answer is never typed at a child that has
 *    said nothing, and the next answer always waits for the next thing the child
 *    prints. Nothing here is a delay before the command runs: the window measures
 *    silence between what the child writes, so a slow machine simply asks later.
 *  - A terminal that ECHOES what was typed back is proof it was still canonical at
 *    that moment, which means an Enter did not survive as one. When that happens to
 *    an answer that needs a real CR, it is typed again on the next turn (bounded by
 *    {@link MAX_ANSWER_ATTEMPTS}).
 * What it cannot survive is a working phase that has quiet gaps of its own: those
 * gaps spend the answers before the question exists, and the prompt then waits for
 * input that has already been typed (and swallowed — a spinner holds the terminal
 * and consumes stray keys) until the step's budget runs out. That is precisely the
 * failure prompt-keying removes, and why anything new should be keyed.
 */

import { isPromptKeyedStdin } from '@truecourse/shared'
import type { StepCapture, ExecuteStepOptions } from './executor.js'
import { DEFAULT_STEP_TIMEOUT_MS } from './executor.js'
import { DETERMINISM_PINS } from './child-env.js'

/** The terminal the child is told it is on — dumb enough to keep output plain. */
const PTY_TERM = 'xterm-256color'
/** Terminal geometry, pinned like every other determinism input (`COLUMNS`). */
const PTY_COLS = Number(DETERMINISM_PINS.COLUMNS ?? 80)
const PTY_ROWS = 24

/**
 * How long the child must write NOTHING before the next scripted answer is typed.
 * It measures a silence between output events, not a delay before one: a prompt
 * that draws in one burst is answered a window later, and a command still working
 * keeps resetting it, so the window is never a race with how fast the machine is.
 */
const PROMPT_QUIET_MS = 150

/**
 * How many times ONE answer is typed while the terminal keeps echoing it back —
 * the evidence that it is still canonical and the keystroke did not survive. A
 * command that reaches its prompt stops the retries by itself; the bound is what
 * keeps a command that NEVER leaves canonical mode (a scenario scripting Enter at
 * something that reads plain lines) from being fed the same key all step long.
 */
const MAX_ANSWER_ATTEMPTS = 5

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

/**
 * Split a scripted `stdin` into the ANSWERS it contains — one per submit key,
 * which is kept with the answer it submits (`\r\n` is one keystroke's worth, not
 * two). A trailing fragment with no submit key is an answer of its own: a prompt
 * that reads a single keypress needs no Enter.
 */
function splitAnswers(stdin: string): string[] {
  return stdin.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+/g) ?? []
}

/**
 * Every escape sequence a terminal program writes to POSITION, COLOR or ERASE —
 * CSI (`ESC [ … final`), OSC (`ESC ] …` up to its BEL/ST terminator) and the
 * two-byte Fe escapes. Stripped before a prompt marker is looked for, so a marker
 * matches the words the program wrote rather than the decoration a prompt library
 * wrapped them in (a spinner redrawing its line, a bold question, a hidden cursor).
 */
const ANSI_SEQUENCE =
  /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g

/** What a program WROTE, with the terminal's own doing removed. */
function markerText(chunk: string): string {
  return chunk.replace(ANSI_SEQUENCE, '').replaceAll('\r\n', '\n')
}

/**
 * A tail that may still GROW into something {@link markerText} would transform: a
 * lone `\r` (half of a `\r\n`) or an escape sequence that has not terminated yet.
 * Anchored at both ends, so a COMPLETE sequence followed by text is never held —
 * held bytes wait for the next chunk, and a child that has just drawn its prompt
 * writes nothing more until it is answered.
 */
const PARTIAL_ESCAPE = /^\u001b(?:\[[0-9;?]*[ -/]*|\][^\u0007\u001b]*|)$/

/** How many trailing characters of `text` must wait for the next chunk. */
function heldBack(text: string): number {
  if (text.endsWith('\r')) return 1
  const esc = text.lastIndexOf('\u001b')
  if (esc >= 0 && PARTIAL_ESCAPE.test(text.slice(esc))) return text.length - esc
  return 0
}

/**
 * What a CANONICAL, echoing line discipline sends back the instant `answer` is
 * typed at it: submit keys as `\r\n` (`ICRNL` then `ONLCR`), other control bytes
 * in caret notation (`ECHOCTL`, so `ESC` reads `^[`), printables as themselves.
 * The echo is the TERMINAL's, produced before the program can have read anything,
 * so a chunk equal to this is proof of the mode — never a reaction to the keys.
 */
function echoOf(answer: string): string {
  let echo = ''
  for (const ch of answer) {
    const code = ch.charCodeAt(0)
    if (ch === '\r' || ch === '\n') echo += '\r\n'
    else if (ch === '\t') echo += ch
    else if (code < 0x20 || code === 0x7f) echo += `^${String.fromCharCode(code ^ 0x40)}`
    else echo += ch
  }
  return echo
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
          if (quiet) clearTimeout(quiet)
          opts.signal?.removeEventListener('abort', onAbort)
          resolve(capture)
        }

        // --- Scripted input, one answer at a time (see the module doc) ---

        /** The prompt-keyed script, when the scenario wrote one. */
        const keyed = isPromptKeyedStdin(opts.stdin) ? opts.stdin : null
        /** The keyed answer waiting for its question. */
        let awaiting = 0
        /** Everything the child has written, as {@link markerText} sees it. */
        let markerView = ''
        /** Tail bytes that may still grow — see {@link heldBack}. */
        let markerCarry = ''
        /** Where the next marker search starts: past the marker just answered. */
        let markerCursor = 0

        /**
         * Type every keyed answer whose question has now been asked. The search
         * starts past the previous marker, so the questions must arrive in the
         * scripted ORDER and a repeated wording is two questions, not one.
         */
        function answerAskedPrompts(chunk: string): void {
          if (settled || !keyed || awaiting >= keyed.length) return
          const buf = markerCarry + chunk
          const held = heldBack(buf)
          markerCarry = held ? buf.slice(buf.length - held) : ''
          markerView += markerText(held ? buf.slice(0, buf.length - held) : buf)
          while (awaiting < keyed.length) {
            const { marker, answer } = keyed[awaiting]
            const at = markerView.indexOf(marker, markerCursor)
            if (at < 0) return
            markerCursor = at + marker.length
            awaiting += 1
            try {
              child.write(answer)
            } catch {
              // The child is gone — its exit settles the step.
            }
          }
          // Every answer is delivered: stop tracking what the child writes. The
          // rest of a run's output can be large, and nothing is looking for it.
          markerView = ''
          markerCarry = ''
        }

        /** The plain script's answers — empty when the step is prompt-keyed. */
        const answers = keyed ? [] : splitAnswers(typeof opts.stdin === 'string' ? opts.stdin : '')
        /** The answer waiting to be typed. */
        let index = 0
        /** Times the answer at `index` has been typed. */
        let attempts = 0
        /** The answer typed last, whose delivery the next turn judges. */
        let typed: string | undefined
        /** The first thing the child wrote after that answer — the echo, or not. */
        let firstReply: string | undefined
        let quiet: NodeJS.Timeout | undefined

        function armQuiet(): void {
          if (settled || index >= answers.length) return
          if (quiet) clearTimeout(quiet)
          quiet = setTimeout(onTurn, PROMPT_QUIET_MS)
          quiet.unref()
        }

        function typeAnswer(): void {
          typed = answers[index]
          attempts += 1
          firstReply = undefined
          try {
            child.write(typed)
          } catch {
            // The child is gone — its exit settles the step.
          }
        }

        /**
         * The child has gone quiet. Retype the last answer if the terminal echoed
         * it (still canonical, so its Enter was folded into a newline and never
         * pressed); otherwise it went in as keys and the next answer is due.
         */
        function onTurn(): void {
          if (settled) return
          if (typed !== undefined) {
            const canonical = firstReply === echoOf(typed)
            if (canonical && typed.includes('\r') && attempts < MAX_ANSWER_ATTEMPTS) {
              typeAnswer()
              return
            }
            index += 1
            attempts = 0
            typed = undefined
            if (index >= answers.length) return
          }
          typeAnswer()
        }

        timer = setTimeout(() => {
          timedOut = true
          kill()
        }, timeoutMs)
        timer.unref()
        opts.signal?.addEventListener('abort', onAbort, { once: true })

        child.onData((data) => {
          output += data
          if (keyed) {
            answerAskedPrompts(data)
            return
          }
          if (typed !== undefined) firstReply ??= data
          armQuiet()
        })

        child.onExit(({ exitCode, signal }) => {
          // An answer still waiting for its question when the child is gone: the
          // question was never asked. Reported as a fact about the run, so the
          // step settles on what happened instead of on how long it took.
          const unasked = keyed && awaiting < keyed.length ? keyed[awaiting].marker : undefined
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
            ...(unasked !== undefined ? { unaskedPrompt: unasked } : {}),
            durationMs: Date.now() - start,
          })
        })
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
