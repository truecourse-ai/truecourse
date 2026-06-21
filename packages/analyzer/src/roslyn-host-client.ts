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
 * Resolve the built host binary. Honours $TRUECOURSE_ROSLYN_HOST, otherwise looks
 * in the in-repo build output relative to this module. Returns null if not found.
 */
export function resolveRoslynHostBinary(): string | null {
  const override = process.env[HOST_BINARY_ENV]
  if (override) return existsSync(override) ? override : null

  const here = dirname(fileURLToPath(import.meta.url))
  const rel = 'tools/csharp-roslyn-host/bin/Release/net8.0/csharp-roslyn-host'
  // works from packages/analyzer/src and from a bundled dist a level or two deeper
  for (const up of ['../../..', '../../../..', '../../../../..']) {
    const candidate = resolve(here, up, rel)
    if (existsSync(candidate)) return candidate
  }
  return null
}

interface HostResponse {
  ok: boolean
  violations?: RoslynHostViolation[]
  error?: string
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

  return new Promise<RoslynHostViolation[]>((resolvePromise, reject) => {
    const child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d: string) => (stdout += d))
    child.stderr.on('data', (d: string) => (stderr += d))

    child.on('error', (e) =>
      reject(
        new RoslynHostUnavailableError(
          `Failed to start the Roslyn host (${bin}): ${e.message}. Is the .NET runtime installed?`,
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

    child.stdin.write(JSON.stringify({ op: 'analyze', files, rules }) + '\n')
    child.stdin.end()
  })
}
