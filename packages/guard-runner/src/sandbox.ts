/**
 * Per-scenario sandbox: a fresh temp `cwd`, an isolated `HOME`/`XDG_*` inside the
 * sandbox (the user's real machine state never leaks in or gets touched), a pinned
 * deterministic env, and declaratively seeded `setup.files`.
 *
 * The child env is built from an ALLOWLIST, not from `process.env`. Only what a
 * program legitimately needs to run — `PATH`, the sandbox-redirected HOME/XDG/TMP,
 * the determinism pins — plus explicitly declared `recipe.env` / `setup.env`
 * reaches a scenario. Host secrets (`ANTHROPIC_API_KEY`), `TRUECOURSE_*`, and proxy
 * config are excluded by construction, so scenario outcomes are machine-independent.
 *
 * Network-egress blocking is intentionally OUT of scope for the CLI driver in this
 * phase — the sandbox isolates the filesystem/HOME and pins env, but does not sever
 * network access. Egress control arrives with the api driver (a later phase).
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { DEFAULT_BUILD_TIMEOUT_MS, type BuildResult } from './build.js'
import { armChildKill } from './child-kill.js'
import { constructChildEnv, sandboxXdgDirs, DETERMINISM_PINS, overlayStepEnv, BUILD_PASSTHROUGH } from './child-env.js'
import { executeStep, type StepCapture } from './executor.js'
import { materializeSupplied, SUPPLIED_DIR, type SuppliedInstance, type SuppliedValues } from './dependencies.js'

// Re-exported for existing importers (evidence `envPins`, index barrel).
export { DETERMINISM_PINS }

export interface Sandbox {
  /** Working directory the entrypoint is invoked in. */
  cwd: string
  /** Sandbox root (contains `cwd` and the isolated home). */
  root: string
  /** Fully-constructed child env (see the build rules below). */
  env: NodeJS.ProcessEnv
  /** What each supplied instance resolved to (a copied-in path, the exported env), by name. */
  supplied: SuppliedValues
  cleanup(): void
}

export class SandboxError extends Error {}

export interface SandboxOptions {
  recipeEnv?: Record<string, string>
  scenarioEnv?: Record<string, string>
  setupFiles?: Record<string, string>
  /** Provided supplied instances to copy in before anything runs. */
  supplied?: readonly SuppliedInstance[]
}

export function createSandbox(opts: SandboxOptions = {}): Sandbox {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-'))
  const cwd = path.join(root, 'work')
  const home = path.join(root, 'home')
  const tmp = path.join(root, 'tmp')
  fs.mkdirSync(cwd, { recursive: true })
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(tmp, { recursive: true })

  const xdg = sandboxXdgDirs(home)
  for (const dir of Object.values(xdg)) fs.mkdirSync(dir, { recursive: true })

  // Supplied instances land BEFORE anything else can name them: copy-in, never a
  // reference to the host original, and their declared env is exported below.
  const { values: supplied, env: suppliedEnv } = materializeSupplied(opts.supplied ?? [], { cwd, home })

  // Allowlist, built from scratch — nothing else from the host reaches the child.
  const env = constructChildEnv({
    sandbox: { home, tmp },
    // A supplied `env` instance is a REGISTERED value, so it layers with the recipe's
    // own env (below the scenario's, which may still override it deliberately).
    recipeEnv: { ...opts.recipeEnv, ...suppliedEnv },
    scenarioEnv: opts.scenarioEnv,
  })

  if (opts.setupFiles) seedFiles(cwd, opts.setupFiles)

  return {
    cwd,
    root,
    env,
    supplied,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true })
    },
  }
}

/**
 * Absolute path of a sandbox-relative path, or a {@link SandboxError} naming the
 * escape. THE containment rule every declared path goes through — a step's `cwd`,
 * a seeded file — so a scenario can never reach the developer's filesystem,
 * whatever it declares.
 */
export function resolveInSandbox(cwd: string, rel: string, what: string): string {
  const target = path.resolve(cwd, rel)
  if (target !== cwd && !target.startsWith(cwd + path.sep)) {
    throw new SandboxError(`${what} path escapes the sandbox: ${rel}`)
  }
  return target
}

/** Seed `setup.files` into the sandbox cwd, rejecting any path that escapes it. */
function seedFiles(cwd: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const target = resolveInSandbox(cwd, rel, 'setup.files')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
}

/**
 * A PERSISTENT sandbox an agent session works in across turns. Every other
 * sandbox in this file is fresh/single-use — created, one scenario, cleaned up.
 * Recipe-repair and seed sessions need the opposite: one world where an
 * install's `node_modules`, a build's `dist/`, a scaffolded project accumulate
 * call over call, so turn 7 builds on what turn 3 installed. Same isolation as
 * every sandbox (allowlist env, redirected HOME/XDG/TMP, containment via
 * {@link resolveInSandbox}); only the lifetime differs — the caller holds it
 * open across an entire session and `cleanup()` is unchanged.
 */
export interface WorkingSandbox extends Sandbox {
  /**
   * argv exec via the existing {@link executeStep} — pipes, hard timeout, group
   * kill, zero retries. `cwd` defaults to the sandbox cwd; a supplied one is
   * resolved against it and refused if it escapes.
   */
  exec(
    argv: string[],
    opts?: {
      cwd?: string
      env?: Record<string, string>
      stdin?: string
      timeoutMs?: number
      signal?: AbortSignal
    },
  ): Promise<StepCapture>
  /**
   * A `shell: true` command via the `runBuild` machinery — install/build class,
   * 600s default timeout, combined stdout+stderr, detached POSIX group-kill.
   * Runs in the SANDBOX cwd, not the repo root: that is the difference from
   * `runBuild`, which prepares the real working tree once per run — here the
   * session iterates in its own world, and nothing it installs or builds
   * touches the developer's checkout.
   */
  shell(command: string, opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<BuildResult>
}

/**
 * Create a {@link WorkingSandbox}: an ordinary {@link createSandbox} world plus
 * the two ways a session runs commands in it. The `shell` env is the sandbox
 * env layered OVER the build passthrough set — proxy/TLS config and toolchain
 * roots ({@link BUILD_PASSTHROUGH}) reach an install the sandbox env alone
 * would starve, while the sandbox's redirected HOME/XDG/TMP and determinism
 * pins still win, so host user config and secrets stay out.
 */
export function createWorkingSandbox(opts: SandboxOptions = {}): WorkingSandbox {
  const sandbox = createSandbox(opts)

  // Passthrough base first, sandbox env second (sandbox wins): BUILD_PASSTHROUGH
  // names HOME/XDG too, and those MUST stay the redirected sandbox dirs.
  const shellEnv: NodeJS.ProcessEnv = {
    ...constructChildEnv({ passthrough: BUILD_PASSTHROUGH }),
    ...sandbox.env,
  }

  return {
    ...sandbox,
    exec(argv, execOpts = {}) {
      const cwd = execOpts.cwd !== undefined
        ? resolveInSandbox(sandbox.cwd, execOpts.cwd, 'exec cwd')
        : sandbox.cwd
      return executeStep({
        argv,
        cwd,
        env: overlayStepEnv(sandbox.env, execOpts.env),
        ...(execOpts.stdin !== undefined ? { stdin: execOpts.stdin } : {}),
        ...(execOpts.timeoutMs !== undefined ? { timeoutMs: execOpts.timeoutMs } : {}),
        ...(execOpts.signal ? { signal: execOpts.signal } : {}),
      })
    },
    shell(command, shellOpts = {}) {
      return runSandboxShell(sandbox.cwd, shellEnv, command, shellOpts)
    },
  }
}

/**
 * The `runBuild`-style spawn, pointed into the sandbox: `shell: true`, detached
 * POSIX group-lead (so the timeout SIGKILL reaps whatever the shell forked),
 * combined stdout+stderr, settle on `close`/`error`. Kept here rather than
 * reusing `runBuild` itself because that one is defined to run in the repo root
 * with the passthrough-only env — the two differences that make this a
 * WORKING-sandbox shell.
 */
function runSandboxShell(
  cwd: string,
  env: NodeJS.ProcessEnv,
  command: string,
  opts: { timeoutMs?: number; signal?: AbortSignal },
): Promise<BuildResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS
  // Already-cancelled callers never spawn anything (same rule as runBuild).
  if (opts.signal?.aborted) {
    return Promise.resolve({ ok: false, command, exitCode: null, timedOut: false, output: '' })
  }
  return new Promise<BuildResult>((resolve) => {
    const child = spawn(command, {
      cwd,
      env,
      shell: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let output = ''
    let settled = false

    const kill = armChildKill(child, timeoutMs, opts.signal, { processGroup: true })

    const finish = (exitCode: number | null): void => {
      if (settled) return
      settled = true
      kill.disarm()
      resolve({
        ok: exitCode === 0 && !kill.timedOut,
        command,
        exitCode,
        timedOut: kill.timedOut,
        output,
      })
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

/**
 * Recursively list files under `dir` (sandbox-relative, sorted) for evidence.
 *
 * The supplied-instance copy is skipped: it is the USER's registered project or
 * corpus, not anything the scenario produced, and listing a whole codebase would
 * bury the handful of files a reader is looking for.
 */
export function listSandboxFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (current === dir && entry.name === SUPPLIED_DIR) continue
        walk(full)
      } else out.push(path.relative(dir, full))
    }
  }
  if (fs.existsSync(dir)) walk(dir)
  return out.sort()
}
