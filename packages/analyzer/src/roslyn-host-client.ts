/**
 * Client for the C# Roslyn semantic host (tools/csharp-roslyn-host).
 *
 * The host is NOT an LSP — it speaks our own newline-delimited JSON protocol and
 * runs our C# rules against Roslyn's semantic model, returning violations. This
 * client spawns it as a batch child process: one `analyze` request with all the
 * C# files, one response, then the process exits.
 *
 * C# semantic analysis is build-required: if the host binary isn't available (or
 * the .NET runtime can't run it), this FAILS — there is no tree-sitter fallback,
 * by design (a silent half-analysis is worse than a clear error).
 */

import { spawn } from 'child_process'
import { existsSync } from 'fs'
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

/** Spawn the host with one request line and resolve its single JSON response. */
function invokeHost(bin: string, request: object): Promise<RoslynHostViolation[]> {
  return new Promise<RoslynHostViolation[]>((resolvePromise, reject) => {
    // A `.dll` is the portable framework-dependent host — launch it through the
    // shared `dotnet` runtime, so one build runs on every OS. A non-.dll path is
    // a native apphost (in-repo dev build) that bootstraps its own runtime.
    const viaDotnet = bin.endsWith('.dll')
    const cmd = viaDotnet ? 'dotnet' : bin
    const args = viaDotnet ? [bin] : []
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d: string) => (stdout += d))
    child.stderr.on('data', (d: string) => (stderr += d))

    child.on('error', (e) =>
      reject(
        new RoslynHostUnavailableError(
          `Failed to start the Roslyn host (${viaDotnet ? `dotnet ${bin}` : bin}): ${e.message}. Is the .NET runtime installed?`,
        ),
      ),
    )

    child.on('close', () => {
      const line = stdout.split('\n').find((l) => l.trim())
      if (!line) {
        reject(new Error(`Roslyn host produced no output.${stderr ? ` stderr: ${stderr}` : ''}`))
        return
      }
      let resp: HostResponse
      try {
        resp = JSON.parse(line) as HostResponse
      } catch {
        reject(new Error(`Roslyn host returned invalid JSON: ${line}`))
        return
      }
      if (!resp.ok) {
        reject(new Error(`Roslyn host error: ${resp.error ?? 'unknown'}`))
        return
      }
      resolvePromise(resp.violations ?? [])
    })

    child.stdin.write(JSON.stringify(request) + '\n')
    child.stdin.end()
  })
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
  const bin = resolveRoslynHostBinary()
  if (!bin) {
    return Promise.reject(
      new RoslynHostUnavailableError(
        'C# semantic analysis requires the Roslyn host. Build it with ' +
          '`dotnet build -c Release tools/csharp-roslyn-host`, or set ' +
          `$${HOST_BINARY_ENV} to the built binary.`,
      ),
    )
  }
  return invokeHost(bin, { op: 'analyze-project', project: projectPath, rules })
}

/**
 * Run the C# semantic rules over `files` via the Roslyn host.
 * @param rules optional allow-list of rule keys; omit to run all host rules.
 * @throws RoslynHostUnavailableError if the host is missing or can't start.
 */
export function runRoslynHost(files: RoslynFile[], rules?: string[]): Promise<RoslynHostViolation[]> {
  const bin = resolveRoslynHostBinary()
  if (!bin) {
    return Promise.reject(
      new RoslynHostUnavailableError(
        'C# semantic analysis requires the Roslyn host. Build it with ' +
          '`dotnet build -c Release tools/csharp-roslyn-host`, or set ' +
          `$${HOST_BINARY_ENV} to the built binary.`,
      ),
    )
  }

  return invokeHost(bin, { op: 'analyze', files, rules })
}
