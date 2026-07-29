/**
 * Api-driver server lifecycle — boot the recipe's `serve` argv as a child
 * process, wait for its health endpoint, and kill the whole process tree on
 * stop. One server per scenario: the process runs with the scenario sandbox as
 * its cwd (fresh state per scenario, same isolation the cli driver gets) and a
 * runner-allocated free port injected as `PORT`, so parallel scenarios never
 * collide. Server stdout/stderr are captured for evidence — a server that dies
 * or never turns healthy reports WHAT it printed, not just that it didn't answer.
 *
 * The lifecycle is a SEAM, not a secret: {@link spawnApiProcess} creates the child,
 * {@link awaitApiServerReady} waits for health, and the handle exposes `signal`,
 * `waitForExit` and `exit` — so a scenario's `boot` / `signal` steps drive the very
 * same process the implicit boot does, with no second spawn path to drift from.
 *
 * `PORT` alone only serves servers that read it (the Node convention). The other
 * ecosystems need the number INSIDE an argv or an env value — `uvicorn --port
 * <n>`, `ASPNETCORE_URLS=http://127.0.0.1:<n>` — so the literal token `${PORT}`
 * is substituted with the allocated port in every serve-argv element and every
 * env VALUE, at spawn time. Substitution is per boot and non-mutating: the recipe
 * (and the fingerprint over it) keeps the TEMPLATE text, so a port allocation
 * never re-plans.
 */

import net from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'

/** Poll interval while waiting for the health endpoint. */
const HEALTH_POLL_INTERVAL_MS = 100
/** Per-attempt budget for one health request (the overall budget is `readyTimeoutMs`). */
const HEALTH_ATTEMPT_TIMEOUT_MS = 2_000
/** Grace between the stop SIGKILL and giving up on the close event. */
const STOP_WAIT_MS = 5_000

export interface ApiServerHandle {
  port: number
  /** `http://127.0.0.1:<port>` — the base every step's `path` is appended to. */
  baseUrl: string
  /** The server's captured output so far (grows while the server runs). */
  logs(): { stdout: string; stderr: string }
  /** SIGKILL the server's process tree and wait for it to close. Idempotent. */
  stop(): Promise<void>
  /**
   * Deliver a signal to the server's process tree (the group, like {@link stop}).
   * A scenario-visible action: this is how a graceful-shutdown claim is exercised.
   * Silently no-ops once the process is gone — the caller observes the exit.
   */
  signal(name: NodeJS.Signals): void
  /**
   * Wait up to `timeoutMs` for the process to close. Resolves with how it went
   * down — `code` for a self-chosen exit, `signal` when it was killed — or
   * `{ exited: false }` when it is still running at the deadline. The process is
   * NOT killed on timeout; the caller decides what a still-running server means.
   */
  waitForExit(timeoutMs: number): Promise<ApiServerExit>
  /** How the process exited, or `null` while it is still running. */
  exit(): ApiServerExit | null
}

/** A closed server process: its exit code, or the signal that killed it. */
export type ApiServerExit =
  | { exited: true; code: number | null; signal: NodeJS.Signals | null }
  | { exited: false }

export type StartApiServerResult =
  | { ok: true; server: ApiServerHandle }
  | {
      ok: false
      /** One-line reason: exited early, never became healthy, or failed to spawn. */
      reason: string
      /**
       * True ONLY for a health-timeout — the server came up but didn't answer 2xx in
       * the budget. This is the transient-pressure class a lone retry can clear; a
       * spawn error or early exit is deterministic (false) and re-crashes on retry.
       */
      timedOut: boolean
      /**
       * True when the CHILD ITSELF could not be spawned (a missing interpreter, an
       * unexecutable serve argv). Infrastructure in every caller's book — a `boot`
       * step's readiness EXPECTATION cannot be judged against a process that never
       * existed, so it settles as an `error` rather than a `fail`.
       */
      spawnFailed: boolean
      stdout: string
      stderr: string
    }

export interface StartApiServerOptions {
  /** Absolute-resolved serve argv (see `resolveEntry`); `${PORT}` is substituted here. */
  resolvedServe: string[]
  /** Working directory the server runs in (the scenario sandbox cwd). */
  cwd: string
  /** Fully-constructed child env; the runner adds `PORT` and substitutes `${PORT}` in values. */
  env: NodeJS.ProcessEnv
  /** Health endpoint path (starts with `/`), polled until 2xx. */
  healthPath: string
  /** Overall wall-clock budget for the server to become healthy. */
  readyTimeoutMs: number
  /** Run-level cancellation; kills the boot in progress. */
  signal?: AbortSignal
}

/** The literal placeholder a recipe writes where the allocated port belongs. */
export const PORT_PLACEHOLDER = '${PORT}'

/** Replace EVERY `${PORT}` occurrence in one string with the allocated port. */
export function substitutePort(text: string, port: number): string {
  return text.split(PORT_PLACEHOLDER).join(String(port))
}

/**
 * Resolve the `${PORT}` placeholder across one boot's serve argv and env. Returns
 * NEW values — the inputs (and through them the recipe object) are never mutated,
 * so each scenario's boot substitutes its own port into the same template.
 */
export function substitutePortInSpawn(
  serve: readonly string[],
  env: NodeJS.ProcessEnv,
  port: number,
): { serve: string[]; env: NodeJS.ProcessEnv } {
  const substituted: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    substituted[key] = typeof value === 'string' ? substitutePort(value, port) : value
  }
  return { serve: serve.map((arg) => substitutePort(arg, port)), env: substituted }
}

/** Allocate a free localhost port by binding to 0 and reading the assignment. */
export function allocateFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address()
      if (address === null || typeof address === 'string') {
        srv.close()
        reject(new Error('could not allocate a port'))
        return
      }
      const { port } = address
      srv.close(() => resolve(port))
    })
  })
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

/** A spawned server process before anything has been waited on. */
export interface SpawnedApiServer {
  server: ApiServerHandle
  /** The spawn error message, once one has been observed (`null` otherwise). */
  spawnError(): string | null
}

/**
 * Spawn the server process and return its handle — no waiting, no health check.
 * The ONE place a server child is created: {@link startApiServer} composes it with
 * the health poll, and a scenario's `boot` step that expects the process to EXIT
 * composes it with {@link ApiServerHandle.waitForExit} instead.
 */
export async function spawnApiProcess(opts: StartApiServerOptions): Promise<SpawnedApiServer> {
  const port = await allocateFreePort()
  const baseUrl = `http://127.0.0.1:${port}`
  // Per-boot `${PORT}` resolution; `PORT` itself is still injected (additive, so a
  // recipe that only relies on the env var is untouched).
  const spawnSpec = substitutePortInSpawn(opts.resolvedServe, opts.env, port)
  const [command, ...args] = spawnSpec.serve

  const child = spawn(command, args, {
    cwd: opts.cwd,
    env: { ...spawnSpec.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group so stop() can kill the tree, not just the direct child.
    detached: process.platform !== 'win32',
  })

  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf-8')
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf-8')
  })

  let exit: ApiServerExit | null = null
  let spawnError: string | null = null
  const closed = new Promise<void>((resolve) => {
    child.on('error', (err) => {
      spawnError = err.message
      exit = { exited: true, code: null, signal: null }
      resolve()
    })
    child.on('close', (code, signal) => {
      exit = exit ?? { exited: true, code, signal }
      resolve()
    })
  })

  const stop = async (): Promise<void> => {
    if (!exit) signalTree(child, 'SIGKILL')
    await Promise.race([closed, new Promise((r) => setTimeout(r, STOP_WAIT_MS))])
  }

  const waitForExit = async (timeoutMs: number): Promise<ApiServerExit> => {
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
    server: {
      port,
      baseUrl,
      logs: () => ({ stdout, stderr }),
      stop,
      signal: (name) => {
        if (!exit) signalTree(child, name)
      },
      waitForExit,
      exit: () => exit,
    },
  }
}

/**
 * Boot the server and wait until `GET <healthPath>` answers 2xx. On any failure
 * (spawn error, early exit, health timeout, abort) the child is killed and the
 * captured output returned — the server never outlives a failed start.
 */
export async function startApiServer(opts: StartApiServerOptions): Promise<StartApiServerResult> {
  if (opts.signal?.aborted) {
    return {
      ok: false,
      reason: 'run aborted before the api server started',
      timedOut: false,
      spawnFailed: false,
      stdout: '',
      stderr: '',
    }
  }
  const spawned = await spawnApiProcess(opts)
  const { server } = spawned
  const ready = await awaitApiServerReady(spawned, opts)
  if (ready.ok) return { ok: true, server }
  // An already-dead process needs no kill; anything still running must not outlive
  // a failed start.
  if (!server.exit()) await server.stop()
  return {
    ok: false,
    reason: ready.reason,
    timedOut: ready.timedOut,
    spawnFailed: spawned.spawnError() !== null,
    ...server.logs(),
  }
}

/**
 * Poll `GET <healthPath>` until it answers 2xx, the process dies, the budget runs
 * out, or the run is cancelled. Never kills the child — the caller owns that, so a
 * `boot` step can report a failed readiness expectation with the process's own
 * output and still tear down exactly once.
 */
export async function awaitApiServerReady(
  spawned: SpawnedApiServer,
  opts: Pick<StartApiServerOptions, 'healthPath' | 'readyTimeoutMs' | 'signal'>,
): Promise<{ ok: true } | { ok: false; reason: string; timedOut: boolean }> {
  const { server } = spawned
  const deadline = Date.now() + opts.readyTimeoutMs
  const healthUrl = `${server.baseUrl}${opts.healthPath}`
  while (true) {
    if (opts.signal?.aborted) {
      return { ok: false, reason: 'run aborted while the api server was starting', timedOut: false }
    }
    if (server.exit()) {
      const spawnError = spawned.spawnError()
      return {
        ok: false,
        reason: spawnError
          ? `api server failed to spawn: ${spawnError}`
          : 'api server exited before becoming healthy',
        // A spawn error / early exit is deterministic — a retry re-crashes it.
        timedOut: false,
      }
    }
    if (Date.now() > deadline) {
      return {
        ok: false,
        reason: `api server did not answer GET ${opts.healthPath} with 2xx within ${opts.readyTimeoutMs}ms`,
        // The server came up but never turned healthy — the transient class a retry clears.
        timedOut: true,
      }
    }
    try {
      const res = await fetch(healthUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(HEALTH_ATTEMPT_TIMEOUT_MS),
      })
      // Drain so the socket is released; the body itself is irrelevant.
      await res.arrayBuffer().catch(() => undefined)
      if (res.status >= 200 && res.status < 300) return { ok: true }
    } catch {
      // Not listening yet (or a slow attempt timed out) — keep polling.
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS))
  }
}
