/**
 * Api-driver server lifecycle — boot the recipe's `serve` argv as a child
 * process, wait for its health endpoint, and kill the whole process tree on
 * stop. One server per scenario: the process runs with the scenario sandbox as
 * its cwd (fresh state per scenario, same isolation the cli driver gets) and a
 * runner-allocated free port injected as `PORT`, so parallel scenarios never
 * collide. Server stdout/stderr are captured for evidence — a server that dies
 * or never turns healthy reports WHAT it printed, not just that it didn't answer.
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
}

export type StartApiServerResult =
  | { ok: true; server: ApiServerHandle }
  | {
      ok: false
      /** One-line reason: exited early, never became healthy, or failed to spawn. */
      reason: string
      stdout: string
      stderr: string
    }

export interface StartApiServerOptions {
  /** Absolute-resolved serve argv (see `resolveEntry`). */
  resolvedServe: string[]
  /** Working directory the server runs in (the scenario sandbox cwd). */
  cwd: string
  /** Fully-constructed child env; the runner adds `PORT` itself. */
  env: NodeJS.ProcessEnv
  /** Health endpoint path (starts with `/`), polled until 2xx. */
  healthPath: string
  /** Overall wall-clock budget for the server to become healthy. */
  readyTimeoutMs: number
  /** Run-level cancellation; kills the boot in progress. */
  signal?: AbortSignal
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

/** SIGKILL the child's whole process group (POSIX), falling back to the child. */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return
  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGKILL')
      return
    } catch {
      // Group already gone or not a leader — fall through to the direct kill.
    }
  }
  try {
    child.kill('SIGKILL')
  } catch {
    // Already dead.
  }
}

/**
 * Boot the server and wait until `GET <healthPath>` answers 2xx. On any failure
 * (spawn error, early exit, health timeout, abort) the child is killed and the
 * captured output returned — the server never outlives a failed start.
 */
export async function startApiServer(opts: StartApiServerOptions): Promise<StartApiServerResult> {
  const port = await allocateFreePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const [command, ...args] = opts.resolvedServe

  if (opts.signal?.aborted) {
    return { ok: false, reason: 'run aborted before the api server started', stdout: '', stderr: '' }
  }

  const child = spawn(command, args, {
    cwd: opts.cwd,
    env: { ...opts.env, PORT: String(port) },
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

  let exited = false
  let spawnError: string | null = null
  const closed = new Promise<void>((resolve) => {
    child.on('error', (err) => {
      spawnError = err.message
      exited = true
      resolve()
    })
    child.on('close', () => {
      exited = true
      resolve()
    })
  })

  const stop = async (): Promise<void> => {
    if (!exited) killTree(child)
    await Promise.race([closed, new Promise((r) => setTimeout(r, STOP_WAIT_MS))])
  }

  const deadline = Date.now() + opts.readyTimeoutMs
  const healthUrl = `${baseUrl}${opts.healthPath}`
  while (true) {
    if (opts.signal?.aborted) {
      await stop()
      return { ok: false, reason: 'run aborted while the api server was starting', stdout, stderr }
    }
    if (exited) {
      return {
        ok: false,
        reason: spawnError
          ? `api server failed to spawn: ${spawnError}`
          : 'api server exited before becoming healthy',
        stdout,
        stderr,
      }
    }
    if (Date.now() > deadline) {
      await stop()
      return {
        ok: false,
        reason: `api server did not answer GET ${opts.healthPath} with 2xx within ${opts.readyTimeoutMs}ms`,
        stdout,
        stderr,
      }
    }
    try {
      const res = await fetch(healthUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(HEALTH_ATTEMPT_TIMEOUT_MS),
      })
      // Drain so the socket is released; the body itself is irrelevant.
      await res.arrayBuffer().catch(() => undefined)
      if (res.status >= 200 && res.status < 300) break
    } catch {
      // Not listening yet (or a slow attempt timed out) — keep polling.
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS))
  }

  return {
    ok: true,
    server: {
      port,
      baseUrl,
      logs: () => ({ stdout, stderr }),
      stop,
    },
  }
}
