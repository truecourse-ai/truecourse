/**
 * Run the recipe `build` once per run, in the repo root. A build failure is a
 * run-level error (no scenario executes) — it is reported against the recipe, not
 * as drift. The build runs against the real working tree, so it is not sandboxed;
 * but its env is still built from an allowlist (`BUILD_PASSTHROUGH` + recipe env),
 * never a `...process.env` spread — host secrets never reach the build.
 */

import { spawn } from 'node:child_process'
import { constructChildEnv, BUILD_PASSTHROUGH } from './child-env.js'

export const DEFAULT_BUILD_TIMEOUT_MS = 600_000

export interface BuildResult {
  ok: boolean
  command: string
  exitCode: number | null
  timedOut: boolean
  /** Combined stdout + stderr, for surfacing on failure. */
  output: string
}

export function runBuild(
  repoRoot: string,
  command: string,
  env?: Record<string, string>,
  timeoutMs: number = DEFAULT_BUILD_TIMEOUT_MS,
): Promise<BuildResult> {
  return new Promise<BuildResult>((resolve) => {
    const child = spawn(command, {
      cwd: repoRoot,
      env: constructChildEnv({ recipeEnv: env, passthrough: BUILD_PASSTHROUGH }),
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let output = ''
    let timedOut = false
    let settled = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    const finish = (exitCode: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: exitCode === 0 && !timedOut, command, exitCode, timedOut, output })
    }

    child.stdout.on('data', (c: Buffer) => (output += c.toString('utf-8')))
    child.stderr.on('data', (c: Buffer) => (output += c.toString('utf-8')))
    child.on('error', (err) => {
      output += `\n${err.message}`
      finish(null)
    })
    child.on('close', (code) => finish(code))
  })
}
