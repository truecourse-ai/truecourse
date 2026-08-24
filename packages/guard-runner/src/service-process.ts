/**
 * Managed service processes — the ONE spawn shape every long-running child under
 * test uses, whichever driver starts it. The api driver boots the recipe's server
 * through it (`api/server.ts` adds port allocation and `${PORT}` substitution on
 * top); the cli driver's `boot` step starts a scenario-chosen command through it.
 * Group-led, death-sweep-registered, stdio captured to files with a forward-read
 * drain barrier — so a verdict is never assembled from a half-read stream and a
 * killed CLI leaves no orphan.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { spawn, type ChildProcess } from 'node:child_process'
import type { GuardLogMatch } from '@truecourse/shared'
import { trackProcessGroup } from './child-kill.js'

/** Grace between the stop SIGKILL and giving up on the close event. */
const STOP_WAIT_MS = 5_000
/** Read size for one pass over a service's captured stdout/stderr. */
const LOG_READ_CHUNK = 64 * 1024

/** Default budget for a signalled process to exit (`signal.expect.withinMs`). */
export const SIGNAL_EXIT_TIMEOUT_MS = 10_000
/** Default window a `logs` step waits for its expected lines to appear. */
export const LOGS_WAIT_MS = 2_000
/** Poll interval while a `logs` step waits. */
export const LOGS_POLL_INTERVAL_MS = 25

/** A closed service process: its exit code, or the signal that killed it. */
export type ServiceProcessExit =
  | { exited: true; code: number | null; signal: NodeJS.Signals | null }
  | { exited: false }

export interface ServiceProcessHandle {
  /** The process's captured output as of the last {@link drain}. */
  logs(): { stdout: string; stderr: string }
  /**
   * Flush barrier over the child's stdio: reads the capture files forward, so
   * {@link logs} afterwards carries everything the child has written.
   *
   * It is what makes a verdict's excerpt causal rather than racy. A step's verdict
   * is reached on an observable the process produced AFTER logging (a response, a
   * state file) — the barrier is the guarantee that those bytes are on the earlier
   * side of the boundary, however large the burst that carries them.
   */
  drain(): Promise<void>
  /** SIGKILL the process tree and wait for it to close. Idempotent. */
  stop(): Promise<void>
  /**
   * Deliver a signal to the process tree (the group, like {@link stop}).
   * A scenario-visible action: this is how a graceful-shutdown claim is exercised.
   * Silently no-ops once the process is gone — the caller observes the exit.
   */
  signal(name: NodeJS.Signals): void
  /**
   * Wait up to `timeoutMs` for the process to close. Resolves with how it went
   * down — `code` for a self-chosen exit, `signal` when it was killed — or
   * `{ exited: false }` when it is still running at the deadline. The process is
   * NOT killed on timeout; the caller decides what a still-running service means.
   */
  waitForExit(timeoutMs: number): Promise<ServiceProcessExit>
  /** How the process exited, or `null` while it is still running. */
  exit(): ServiceProcessExit | null
}

/** A spawned service process before anything has been waited on. */
export interface SpawnedServiceProcess {
  handle: ServiceProcessHandle
  /** The spawn error message, once one has been observed (`null` otherwise). */
  spawnError(): string | null
}

export interface SpawnServiceProcessOptions {
  /** Fully-resolved argv (`argv[0]` is the command). */
  argv: string[]
  /** Working directory the service runs in. */
  cwd: string
  /** Fully-constructed child env. */
  env: NodeJS.ProcessEnv
}

/** Everything written to `fd` since the last pass, decoded across read boundaries. */
function readForward(fd: number, decoder: StringDecoder, buffer: Buffer): string {
  let text = ''
  for (;;) {
    const read = fs.readSync(fd, buffer, 0, buffer.length, null)
    if (read === 0) return text
    text += decoder.write(buffer.subarray(0, read))
  }
}

/** Signal the child's whole process group (POSIX), falling back to the child. */
function signalTree(child: ChildProcess, sig: NodeJS.Signals): void {
  if (child.pid === undefined) return
  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, sig)
      return
    } catch {
      // Group already gone or not a leader — fall through to the direct signal.
    }
  }
  try {
    child.kill(sig)
  } catch {
    // Already dead.
  }
}

/**
 * Spawn a service process and return its handle — no waiting, no readiness check.
 * The caller composes it with whatever readiness discipline its driver has (the
 * api health poll, the cli readiness-line match).
 */
export function spawnServiceProcess(opts: SpawnServiceProcessOptions): SpawnedServiceProcess {
  const [command, ...args] = opts.argv

  // The child's stdio goes to FILES, never to pipes. A pipe write bigger than the
  // pipe holds is finished by the WRITER's event loop one pipe-full at a time, so
  // the tail of a burst sits inside the child and its arrival is a matter of when
  // the host next schedules that child — which no reader can observe, only guess
  // at. A file write completes in the syscall instead, so everything the service
  // wrote before an observable is readable the moment the observable lands,
  // whatever the load. It also stops OUR reading from throttling the service: a
  // pipe nobody is draining blocks the child at 64KB, a file never does.
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-svc-log-'))
  const outPath = path.join(logDir, 'stdout.log')
  const errPath = path.join(logDir, 'stderr.log')
  const outWrite = fs.openSync(outPath, 'w')
  const errWrite = fs.openSync(errPath, 'w')

  let child: ChildProcess
  try {
    child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['ignore', outWrite, errWrite],
      // Own process group so stop() can kill the tree, not just the direct child.
      detached: process.platform !== 'win32',
    })
  } catch (e) {
    // A synchronous spawn throw (an argv node refuses before it forks) means no child
    // ever existed to own this capture — and nothing else in the process remembers
    // these paths, so without this the dir and its two files stay in tmp forever.
    fs.rmSync(logDir, { recursive: true, force: true })
    throw e
  } finally {
    // The child holds its own descriptors from here; ours would only leak.
    fs.closeSync(outWrite)
    fs.closeSync(errWrite)
  }

  // A service outlives every step, so a CLI that dies mid-run is the one case
  // `stop()` never reaches; the sweep kills the tree when this process goes down.
  trackProcessGroup(child)

  let stdout = ''
  let stderr = ''
  const outRead = fs.openSync(outPath, 'r')
  const errRead = fs.openSync(errPath, 'r')
  // Nobody opens these paths again, so unlinking now hands the capture's lifetime to
  // the descriptors: however the run ends — including a CLI killed mid-scenario — the
  // OS reclaims it. Windows cannot unlink an open file and drops it at close instead.
  // KNOWN ASYMMETRY: that makes `closeCapture` the only thing that removes the dir on
  // Windows, so a CLI killed mid-run leaks one capture dir per live service there —
  // accepted rather than paid for with a process-wide cleanup registry, since the
  // paths are under tmp and the platform's own tmp sweep reclaims them.
  if (process.platform !== 'win32') {
    fs.unlinkSync(outPath)
    fs.unlinkSync(errPath)
    fs.rmdirSync(logDir)
  }
  // Decoders, not per-read `toString`: a multibyte character split across two reads
  // would otherwise land in the evidence as replacement characters.
  const outDecoder = new StringDecoder('utf-8')
  const errDecoder = new StringDecoder('utf-8')
  const readBuffer = Buffer.allocUnsafe(LOG_READ_CHUNK)
  let captureClosed = false

  /** Read both capture files forward from wherever the last pass stopped. */
  const pull = (): void => {
    if (captureClosed) return
    stdout += readForward(outRead, outDecoder, readBuffer)
    stderr += readForward(errRead, errDecoder, readBuffer)
  }

  /** Last pass over a dead child's capture, then the files are gone. */
  const closeCapture = (): void => {
    if (captureClosed) return
    pull()
    captureClosed = true
    stdout += outDecoder.end()
    stderr += errDecoder.end()
    fs.closeSync(outRead)
    fs.closeSync(errRead)
    fs.rmSync(logDir, { recursive: true, force: true })
  }

  let exit: ServiceProcessExit | null = null
  let spawnError: string | null = null
  const closed = new Promise<void>((resolve) => {
    child.on('error', (err) => {
      spawnError = err.message
      exit = { exited: true, code: null, signal: null }
      closeCapture()
      resolve()
    })
    child.on('close', (code, signal) => {
      exit = exit ?? { exited: true, code, signal }
      closeCapture()
      resolve()
    })
  })

  const drain = async (): Promise<void> => {
    pull()
  }

  const stop = async (): Promise<void> => {
    if (!exit) signalTree(child, 'SIGKILL')
    await Promise.race([closed, new Promise((r) => setTimeout(r, STOP_WAIT_MS))])
  }

  const waitForExit = async (timeoutMs: number): Promise<ServiceProcessExit> => {
    if (exit) return exit
    let timer: NodeJS.Timeout | undefined
    await Promise.race([
      closed,
      new Promise((r) => {
        timer = setTimeout(r, timeoutMs)
      }),
    ])
    if (timer) clearTimeout(timer)
    return exit ?? { exited: false }
  }

  return {
    spawnError: () => spawnError,
    handle: {
      logs: () => ({ stdout, stderr }),
      drain,
      stop,
      signal: (name) => {
        if (!exit) signalTree(child, name)
      },
      waitForExit,
      exit: () => exit,
    },
  }
}

// --- Shared log-step vocabulary (both drivers' `signal` / `logs` steps) ------

/** `“x”` / `/x/` — how a log matcher reads in a failure message. */
export function logMatchLabel(m: GuardLogMatch): string {
  return typeof m === 'string' ? `“${m}”` : `/${m.pattern}/`
}

/** The lines of a log window that match — substring or regex, per LINE. */
export function matchingLogLines(window: string, match: GuardLogMatch): string[] {
  const lines = window.split('\n').filter((l) => l.length > 0)
  if (typeof match === 'string') return lines.filter((l) => l.includes(match))
  const re = new RegExp(match.pattern)
  return lines.filter((l) => re.test(l))
}

/** How a closed process went down, in the words a failure message needs. */
export function exitLabel(exit: { code: number | null; signal: NodeJS.Signals | null }): string {
  if (exit.code !== null) return `exited with code ${exit.code}`
  return exit.signal ? `was killed by ${exit.signal}` : 'exited without a code'
}
