/**
 * Client for the C# Roslyn semantic host (tools/csharp-roslyn-host).
 *
 * The host is NOT an LSP — it speaks our own newline-delimited JSON protocol and
 * runs our C# rules against Roslyn's semantic model, returning violations. The
 * host reads requests in a loop until stdin closes and answers each with exactly
 * one response line, in order, so one process can serve many requests.
 *
 * Two ways to use it:
 *   - `runRoslynHost` / `runRoslynWorkspace` — one-shot. Spawn, ask once, exit.
 *     This is what analyze does: a whole repo's C# files are already one request.
 *   - `openRoslynHost()` — a session held across many requests, for callers that
 *     issue hundreds of small independent ones (the rule test suites). Each
 *     request still gets its own Roslyn compilation, so results are identical to
 *     the one-shot path; only the ~0.8s process boot is amortized.
 *
 * C# semantic analysis is build-required: if the host binary isn't available (or
 * the .NET runtime can't run it), this FAILS — there is no tree-sitter fallback,
 * by design (a silent half-analysis is worse than a clear error).
 */

import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const HOST_BINARY_ENV = 'TRUECOURSE_ROSLYN_HOST'

export interface RoslynFile {
  path: string
  text: string
}

/** Raw violation as emitted by the host (enriched into a CodeViolation by the caller). */
export interface RoslynHostViolation {
  ruleKey: string
  path: string
  line: number
  column: number
  message: string
}

/** Thrown when the host can't be located or started — C# analysis cannot proceed. */
export class RoslynHostUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RoslynHostUnavailableError'
  }
}

/**
 * Resolve the host to launch. Honours $TRUECOURSE_ROSLYN_HOST, otherwise finds
 * either the published host DLL or the in-repo native build. Returns null if
 * neither is present. A `.dll` result is launched via `dotnet` (see invokeHost).
 */
export function resolveRoslynHostBinary(): string | null {
  const override = process.env[HOST_BINARY_ENV]
  if (override) return existsSync(override) ? override : null

  // Two shipping layouts, checked in preference order at each ancestor level:
  //   1. `roslyn-host/csharp-roslyn-host.dll` — the framework-dependent host
  //      bundled next to the published `cli.mjs` (npm installs). One portable
  //      build runs on every OS, launched through the user's `dotnet` runtime.
  //   2. `tools/csharp-roslyn-host/bin/Release/net8.0/csharp-roslyn-host` — the
  //      in-repo native apphost (running from source / a dev checkout).
  // Walk up from this module toward the filesystem root: the flattened top-level
  // `dist/cli.mjs` bundle sits 1 level above the shipped host, while source runs
  // (packages/analyzer/{src,dist}) are ~3 levels above the in-repo build. The old
  // fixed `../../..` offsets missed the dist layout, so C# analysis failed there.
  const rels = [
    'roslyn-host/csharp-roslyn-host.dll',
    'tools/csharp-roslyn-host/bin/Release/net8.0/csharp-roslyn-host',
  ]
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 12; i++) {
    for (const rel of rels) {
      const candidate = resolve(dir, rel)
      if (existsSync(candidate)) return candidate
    }
    const parent = dirname(dir)
    if (parent === dir) break // reached the filesystem root
    dir = parent
  }
  return null
}

interface HostResponse {
  ok: boolean
  violations?: RoslynHostViolation[]
  error?: string
}

/** A host process held open across many requests. Close it when done. */
export interface RoslynHostSession {
  /** Run the host rules over loose file texts (the `analyze` op). */
  analyze(files: RoslynFile[], rules?: string[]): Promise<RoslynHostViolation[]>
  /** Run the project-aware rules over a restored `.csproj`/`.sln` (`analyze-project`). */
  analyzeProject(projectPath: string, rules?: string[]): Promise<RoslynHostViolation[]>
  /** Close stdin and wait for the host to exit. Idempotent. */
  close(): Promise<void>
}

/** The missing-host diagnostic, shared by every entry point into the host. */
function hostUnavailable(): RoslynHostUnavailableError {
  return new RoslynHostUnavailableError(
    'C# semantic analysis requires the Roslyn host. Build it with ' +
      '`dotnet build -c Release tools/csharp-roslyn-host`, or set ' +
      `$${HOST_BINARY_ENV} to the built binary.`,
  )
}

/**
 * Open a Roslyn host session. The process stays up until `close()`, serving
 * requests in order — the host answers each with exactly one response line.
 * @throws RoslynHostUnavailableError if the host binary can't be located.
 */
export function openRoslynHost(): RoslynHostSession {
  const bin = resolveRoslynHostBinary()
  if (!bin) throw hostUnavailable()

  // A `.dll` is the portable framework-dependent host — launch it through the
  // shared `dotnet` runtime, so one build runs on every OS. A non-.dll path is
  // a native apphost (in-repo dev build) that bootstraps its own runtime.
  const viaDotnet = bin.endsWith('.dll')
  const cmd = viaDotnet ? 'dotnet' : bin
  const args = viaDotnet ? [bin] : []
  // Run in a neutral working directory (tmpdir) with no project build config on
  // its path. The host is a read-only semantic analyzer — it compiles file texts
  // (or opens an already-restored project by absolute path) and never builds the
  // target — so it must not honor the target repo's `global.json` SDK pin.
  // Inheriting the analyze cwd let the .NET SDK resolver walk up to that
  // `global.json` and abort at startup when the pinned SDK wasn't installed;
  // tmpdir() is guaranteed free of one. See issue #658.
  const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], cwd: tmpdir() })

  interface Pending {
    resolve(violations: RoslynHostViolation[]): void
    reject(err: Error): void
  }
  // Requests are answered in the order they were sent (the host's loop is
  // sequential), so the queue head always owns the next response line.
  const pending: Pending[] = []
  let stdoutBuffer = ''
  let stderr = ''
  /** Set once the host dies; every later request fails with the same reason. */
  let fatal: Error | undefined
  let exited: Promise<void> | undefined

  const failAll = (err: Error) => {
    fatal ??= err
    while (pending.length) pending.shift()!.reject(err)
  }

  const settleWith = (resp: HostResponse) => {
    // A response with nothing waiting for it would mean the host answered a
    // request we never sent — there is no correct request to attribute it to, so
    // drop it rather than mis-pair it with whatever is sent next.
    const next = pending.shift()
    if (!next) return
    if (!resp.ok) next.reject(new Error(`Roslyn host error: ${resp.error ?? 'unknown'}`))
    else next.resolve(resp.violations ?? [])
  }

  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (d: string) => (stderr += d))
  child.stdout.on('data', (chunk: string) => {
    stdoutBuffer += chunk
    // Complete lines only — the trailing fragment waits for the next chunk.
    let newline: number
    while ((newline = stdoutBuffer.indexOf('\n')) !== -1) {
      const line = stdoutBuffer.slice(0, newline).trim()
      stdoutBuffer = stdoutBuffer.slice(newline + 1)
      if (!line) continue
      // The protocol is one JSON response per line, but the .NET SDK resolver can
      // leak a stray banner (e.g. `8.0.128 [/usr/.../sdk]`) onto stdout. Only a
      // parsed object carrying `ok` is a response; anything else is noise.
      let parsed: HostResponse | undefined
      try {
        const candidate = JSON.parse(line) as HostResponse
        if (candidate && typeof candidate.ok === 'boolean') parsed = candidate
      } catch {
        /* not the JSON response line — skip leaked SDK/runtime banners */
      }
      if (parsed) settleWith(parsed)
    }
  })

  child.on('error', (e) =>
    failAll(
      new RoslynHostUnavailableError(
        `Failed to start the Roslyn host (${viaDotnet ? `dotnet ${bin}` : bin}): ${e.message}. Is the .NET runtime installed?`,
      ),
    ),
  )

  // If the host exits while we're still streaming a large request, the write
  // hits a closed pipe and `child.stdin` emits 'error' (EPIPE). Swallow it here
  // so it isn't an unhandled stream error that crashes the whole process; the
  // real diagnosis comes from the 'close' handler below (exit code + stderr).
  child.stdin.on('error', () => {})

  child.on('close', (code, signalName) => {
    // Requests still queued when the host is gone can never be answered. The
    // reason is on stderr — e.g. the ".NET SDK was not found … global.json …"
    // diagnostic when the SDK resolver aborts at startup.
    if (pending.length === 0) {
      fatal ??= new RoslynHostUnavailableError('The Roslyn host is no longer running.')
      return
    }
    const how = signalName ? `via ${signalName}` : `with code ${code}`
    const reason = stderr.trim() || '(no output)'
    failAll(
      new RoslynHostUnavailableError(
        `The Roslyn host exited ${how} before responding. ` +
          `Is a compatible .NET runtime installed? Host output: ${reason}`,
      ),
    )
  })

  const send = (request: object): Promise<RoslynHostViolation[]> => {
    if (fatal) return Promise.reject(fatal)
    return new Promise<RoslynHostViolation[]>((resolve, reject) => {
      pending.push({ resolve, reject })
      try {
        child.stdin.write(JSON.stringify(request) + '\n')
      } catch {
        // The host already closed stdin (raced with an early exit); the 'close'
        // handler will fire and produce the real error.
      }
    })
  }

  return {
    analyze: (files, rules) => send({ op: 'analyze', files, rules }),
    analyzeProject: (projectPath, rules) =>
      send({ op: 'analyze-project', project: projectPath, rules }),
    close() {
      exited ??= new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve()
        child.once('close', () => resolve())
        child.stdin.end()
      })
      return exited
    },
  }
}

/**
 * Open a session, issue one request, and shut the host down again. Awaiting the
 * exit keeps the one-shot callers' contract unchanged: they only settle once the
 * child is gone, so no host process outlives the call that started it.
 */
async function invokeOnce(
  request: (session: RoslynHostSession) => Promise<RoslynHostViolation[]>,
): Promise<RoslynHostViolation[]> {
  const session = openRoslynHost()
  try {
    return await request(session)
  } finally {
    await session.close()
  }
}

/**
 * Run the project-aware C# semantic rules by opening a real `.csproj`/`.sln` via
 * MSBuildWorkspace (full-fidelity references + project metadata). The project must
 * be restored and buildable; if it can't be loaded the host returns an error and
 * this rejects (no degraded result).
 * @param projectPath absolute path to a .csproj or .sln
 * @param rules optional allow-list of rule keys; omit to run all host rules.
 * @throws RoslynHostUnavailableError if the host is missing or can't start.
 */
export function runRoslynWorkspace(projectPath: string, rules?: string[]): Promise<RoslynHostViolation[]> {
  return invokeOnce((session) => session.analyzeProject(projectPath, rules))
}

/**
 * Run the C# semantic rules over `files` via the Roslyn host.
 * @param rules optional allow-list of rule keys; omit to run all host rules.
 * @throws RoslynHostUnavailableError if the host is missing or can't start.
 */
export function runRoslynHost(files: RoslynFile[], rules?: string[]): Promise<RoslynHostViolation[]> {
  return invokeOnce((session) => session.analyze(files, rules))
}
