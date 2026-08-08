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
import { constructChildEnv, sandboxXdgDirs, DETERMINISM_PINS } from './child-env.js'
import { applySandbox, applySandboxEnv } from './sandbox-token.js'
import { applySupplied, materializeSupplied, SUPPLIED_DIR, type SuppliedInstance, type SuppliedOmissions, type SuppliedValues } from './dependencies.js'
import { resolveEntry } from './recipe.js'

// Re-exported for existing importers (evidence `envPins`, index barrel).
export { DETERMINISM_PINS }

export interface Sandbox {
  /** Working directory the entrypoint is invoked in. */
  cwd: string
  /** Sandbox root (contains `cwd` and the isolated home). */
  root: string
  /** Fully-constructed child env (see the build rules below). */
  env: NodeJS.ProcessEnv
  /** What `${supplied:<name>.<field>}` resolves to, once instances are copied in. */
  supplied: SuppliedValues
  /** The declared-optional fields this machine left blank. See {@link SuppliedOmissions}. */
  suppliedOmissions: SuppliedOmissions
  /** The shim dir on PATH, when the recipe exposes anything; else `null`. */
  shimDir: string | null
  cleanup(): void
}

export class SandboxError extends Error {}

export interface SandboxOptions {
  recipeEnv?: Record<string, string>
  scenarioEnv?: Record<string, string>
  setupFiles?: Record<string, string>
  /** The recipe's `expose` map — programs to put on PATH under their real names. */
  expose?: Record<string, string | string[]>
  /** Repo root, needed to resolve an `expose` entry's built entry path. */
  repoRoot?: string
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

  // Supplied instances land BEFORE anything else can name them: the seeded files and
  // the declared env may both carry `${supplied:…}`, and a step's `cwd` may point
  // into a copied project. Copy-in, never a reference to the host original.
  const {
    values: supplied,
    env: suppliedEnv,
    omissions: suppliedOmissions,
  } = materializeSupplied(opts.supplied ?? [], { cwd, home })

  const shimDir = opts.expose ? writeShims(opts.expose, root, opts.repoRoot ?? process.cwd()) : null

  // `${supplied:…}` then `${sandbox}` — both resolve HERE and nowhere earlier: the
  // paths they name are the ones just created, so the declared env and seeds are the
  // first things that can carry them. The recipe-owned env stays verbatim (it is not
  // scenario-authored).
  const scenarioEnv = opts.scenarioEnv
    ? applySandboxEnv(mapValues(opts.scenarioEnv, (v) => applySupplied(v, supplied)), cwd)
    : undefined

  // Allowlist, built from scratch — nothing else from the host reaches the child.
  const env = constructChildEnv({
    sandbox: { home, tmp },
    // A supplied `env` instance is a REGISTERED value, so it layers with the recipe's
    // own env (below the scenario's, which may still override it deliberately).
    recipeEnv: { ...opts.recipeEnv, ...suppliedEnv },
    scenarioEnv,
    ...(shimDir ? { pathPrefix: [shimDir] } : {}),
  })

  if (opts.setupFiles) {
    seedFiles(
      cwd,
      Object.fromEntries(
        Object.entries(opts.setupFiles).map(([k, v]) => [
          applySandbox(applySupplied(k, supplied), cwd),
          applySandbox(applySupplied(v, supplied), cwd),
        ]),
      ),
    )
  }

  return {
    cwd,
    root,
    env,
    supplied,
    suppliedOmissions,
    shimDir,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true })
    },
  }
}

function mapValues(
  record: Record<string, string>,
  fn: (value: string) => string,
): Record<string, string> {
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, fn(v)]))
}

/**
 * The directory the recipe's `expose` shims are written into, INSIDE the sandbox
 * root and above the scenario cwd — so it never shows up in the working tree a
 * scenario asserts on, and it dies with the sandbox.
 *
 * It is named `node_modules/.bin` for one concrete reason, and it is not an
 * ecosystem assumption: PATH is the contract (that is what makes `expose` work for
 * a Makefile, a shell script, or a git hook in any language), but node's package
 * managers do NOT consult PATH — `npx <name>` walks UP from the working directory
 * looking for `node_modules/.bin/<name>` and, failing that, installs a published
 * copy from the registry. A shim dir that is only on PATH would therefore lose to a
 * download for exactly the case `expose` exists to fix: TrueCourse's own pre-commit
 * hook runs `npx -y truecourse`, and until the shim sat where npx looks, the hook
 * scenarios graded a published release instead of this build. One directory,
 * discovered two ways, no global mutation.
 */
const SHIM_DIR_REL = path.join('node_modules', '.bin')

/** Write one executable shim per `expose` entry; returns the directory. */
function writeShims(
  expose: Record<string, string | string[]>,
  root: string,
  repoRoot: string,
): string {
  const dir = path.join(root, SHIM_DIR_REL)
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, target] of Object.entries(expose)) {
    const argv = resolveEntry(repoRoot, typeof target === 'string' ? [target] : target)
    const script = `#!/bin/sh\nexec ${argv.map(shellQuote).join(' ')} "$@"\n`
    const file = path.join(dir, name)
    fs.writeFileSync(file, script, { mode: 0o755 })
  }
  return dir
}

/** POSIX single-quote quoting — the shim is a `/bin/sh` script, not an argv array. */
function shellQuote(arg: string): string {
  return `'${arg.split("'").join(`'\\''`)}'`
}

/**
 * Absolute path of a sandbox-relative path, or a {@link SandboxError} naming the
 * escape. THE containment rule every declared path goes through — a step's `cwd`,
 * a `write`/`delete` target, a seeded file — so a scenario can never reach the
 * developer's filesystem, whatever it declares.
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
