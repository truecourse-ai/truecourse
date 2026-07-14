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

/**
 * Determinism pins applied to every sandbox — the single source for both the
 * constructed child env and the evidence `envPins` record. Fixed, host-independent
 * values so output comparison is stable: UTC clock, C locale, colour off, fixed
 * terminal width.
 */
export const DETERMINISM_PINS: Readonly<Record<string, string>> = {
  TZ: 'UTC',
  LANG: 'C',
  NO_COLOR: '1',
  COLUMNS: '80',
}

export interface Sandbox {
  /** Working directory the entrypoint is invoked in. */
  cwd: string
  /** Sandbox root (contains `cwd` and the isolated home). */
  root: string
  /** Fully-constructed child env (see the build rules below). */
  env: NodeJS.ProcessEnv
  cleanup(): void
}

export class SandboxError extends Error {}

export interface SandboxOptions {
  recipeEnv?: Record<string, string>
  scenarioEnv?: Record<string, string>
  setupFiles?: Record<string, string>
}

export function createSandbox(opts: SandboxOptions = {}): Sandbox {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-'))
  const cwd = path.join(root, 'work')
  const home = path.join(root, 'home')
  const tmp = path.join(root, 'tmp')
  fs.mkdirSync(cwd, { recursive: true })
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(tmp, { recursive: true })

  const xdg = {
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    XDG_RUNTIME_DIR: path.join(home, 'run'),
  }
  for (const dir of Object.values(xdg)) fs.mkdirSync(dir, { recursive: true })

  // Allowlist, built from scratch — nothing else from the host reaches the child.
  const env: NodeJS.ProcessEnv = {
    // PATH: programs must resolve node/git; the only host value that passes through.
    PATH: process.env.PATH ?? '',
    // Filesystem isolation: HOME + XDG + TMPDIR all redirected inside the sandbox
    // so no user config is read and no temp file lands on the real machine.
    HOME: home,
    USERPROFILE: home,
    TMPDIR: tmp,
    ...xdg,
    ...DETERMINISM_PINS,
  }
  // Recipe env, then scenario env (scenario wins) — the only declared additions.
  if (opts.recipeEnv) Object.assign(env, opts.recipeEnv)
  if (opts.scenarioEnv) Object.assign(env, opts.scenarioEnv)

  if (opts.setupFiles) seedFiles(cwd, opts.setupFiles)

  return {
    cwd,
    root,
    env,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true })
    },
  }
}

/** Seed `setup.files` into the sandbox cwd, rejecting any path that escapes it. */
function seedFiles(cwd: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const target = path.resolve(cwd, rel)
    if (target !== cwd && !target.startsWith(cwd + path.sep)) {
      throw new SandboxError(`setup.files path escapes the sandbox: ${rel}`)
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
}

/** Recursively list files under `dir` (sandbox-relative, sorted) for evidence. */
export function listSandboxFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push(path.relative(dir, full))
    }
  }
  if (fs.existsSync(dir)) walk(dir)
  return out.sort()
}
