/**
 * The preparation recipe (`.truecourse/scenarios/recipe.json`) — how to turn the
 * working tree into a runnable entrypoint. `build` runs once per run in the repo
 * root; `entry` (argv) is stored repo-relative and resolved to absolute at run
 * time so a sandbox in a temp dir can still invoke the built binary.
 *
 * The recipe also carries an inputs fingerprint — a hash of the manifest files
 * that inform discovery across the ecosystems guard supports (JS/TS, Python, C#).
 * The fingerprint is recorded into the run store and keys the recipe's staleness.
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { z } from 'zod'

/**
 * argv0 basenames (compared case-insensitively) that are shell no-ops — they run
 * nothing and exit 0, so an `entry` built on one executes no program under test.
 * A recipe naming one is the sqlfluff-class defect: every scenario "passes"
 * against `true`, minting bogus findings. Rejected in discovery output and in a
 * hand-written recipe.json alike.
 */
const NO_OP_ARGV0: ReadonlySet<string> = new Set(['true', 'false', ':', 'test', '[', 'noop'])

/** Whether the entry's argv0 is a shell no-op rather than the program under test. */
export function isNoOpEntry(entry: readonly string[]): boolean {
  const argv0 = entry[0]
  if (!argv0) return false
  return NO_OP_ARGV0.has(path.basename(argv0).toLowerCase())
}

export const RecipeSchema = z
  .object({
    /** Shell command run once in the repo root to produce the entrypoint. */
    build: z.string().min(1),
    /** Entrypoint argv; scenario `run` argv is appended to this. Repo-relative. */
    entry: z
      .array(z.string())
      .min(1)
      .refine((e) => !isNoOpEntry(e), {
        message: 'entry must invoke the program under test, not a shell no-op',
      }),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict()

export type Recipe = z.infer<typeof RecipeSchema>

export interface LoadedRecipe {
  recipe: Recipe
  /** `sha256:…` over the discovery-input files present in the repo. */
  fingerprint: string
}

/**
 * Fixed-path manifests whose contents inform recipe discovery, across the
 * ecosystems guard supports — JS/TS (package.json + lockfiles + turbo.json),
 * Python (pyproject / setup / requirements), and C# (global.json). Discovered
 * `*.sln`/`*.csproj` files are appended per repo (see {@link discoverCsharpProjectFiles}).
 */
const FINGERPRINT_INPUTS: readonly string[] = [
  'package.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'turbo.json',
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'requirements.txt',
  'global.json',
]

/** Directories never descended when globbing for C# project files. */
const CSHARP_WALK_SKIP: ReadonlySet<string> = new Set(['node_modules', 'bin', 'obj', '.git'])
/** How many directory levels below the repo root the C# project-file glob descends. */
const CSHARP_WALK_MAX_DEPTH = 4

/**
 * Glob the repo's top levels for C# project files (`*.sln`, `*.csproj`),
 * repo-relative and sorted. Skips build output and VCS/dot directories, and stops
 * at {@link CSHARP_WALK_MAX_DEPTH} so a huge tree never turns into a full walk. The
 * sorted result makes both the fingerprint and the discovery inputs deterministic.
 */
export function discoverCsharpProjectFiles(repoRoot: string): string[] {
  const found: string[] = []
  const walk = (dir: string, depth: number): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (depth >= CSHARP_WALK_MAX_DEPTH || entry.name.startsWith('.') || CSHARP_WALK_SKIP.has(entry.name)) continue
        walk(path.join(dir, entry.name), depth + 1)
      } else if (entry.isFile() && (entry.name.endsWith('.sln') || entry.name.endsWith('.csproj'))) {
        found.push(path.relative(repoRoot, path.join(dir, entry.name)))
      }
    }
  }
  walk(repoRoot, 0)
  return found.sort()
}

export class RecipeError extends Error {}

/** Load + validate the recipe, or `null` when the file is absent. */
export function loadRecipe(repoRoot: string, recipeFile: string): LoadedRecipe | null {
  if (!fs.existsSync(recipeFile)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(recipeFile, 'utf-8'))
  } catch (e) {
    throw new RecipeError(`recipe.json is not valid JSON: ${e instanceof Error ? e.message : e}`)
  }
  const result = RecipeSchema.safeParse(parsed)
  if (!result.success) {
    throw new RecipeError(`recipe.json is invalid: ${result.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`)
  }
  return { recipe: result.data, fingerprint: computeRecipeFingerprint(repoRoot) }
}

/**
 * Hash the present discovery-input files (path-tagged) into one digest. The fixed
 * manifests hash in list order; discovered C# project files follow in sorted order,
 * so the digest is deterministic for a given working tree.
 */
export function computeRecipeFingerprint(repoRoot: string): string {
  const hash = crypto.createHash('sha256')
  const rels = [...FINGERPRINT_INPUTS, ...discoverCsharpProjectFiles(repoRoot)]
  for (const rel of rels) {
    const abs = path.join(repoRoot, rel)
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue
    hash.update(rel)
    hash.update('\0')
    hash.update(fs.readFileSync(abs))
    hash.update('\0')
  }
  return `sha256:${hash.digest('hex')}`
}

/**
 * Resolve the recipe entry argv to absolute paths. A bare command (argv[0], e.g.
 * `node`) is pinned to an absolute path via the HOST's PATH at run start, before
 * any sandbox env applies — so a scenario's `setup.env.PATH` override can inject
 * stub executables for CHILD processes the program spawns, but can never swap the
 * interpreter that runs the program under test. Path-like args that resolve to an
 * existing repo file are absolutized so the sandbox — whose cwd is a temp dir —
 * invokes the built artifact.
 */
export function resolveEntry(repoRoot: string, entry: readonly string[]): string[] {
  const [command, ...rest] = entry
  const resolvedCommand = isBareCommand(command)
    ? resolveOnHostPath(command)
    : path.resolve(repoRoot, command)
  const resolvedRest = rest.map((arg) => {
    if (path.isAbsolute(arg)) return arg
    const abs = path.resolve(repoRoot, arg)
    return fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : arg
  })
  return [resolvedCommand, ...resolvedRest]
}

/** A bare command (no separator, not `./`-anchored) is looked up on the host PATH. */
function isBareCommand(command: string): boolean {
  return !command.includes('/') && !command.includes(path.sep) && !command.startsWith('.')
}

/**
 * Resolve a bare command to an absolute executable using the HOST's `process.env.PATH`.
 * Returns the bare name unchanged when nothing on PATH matches (spawn resolves it
 * then). On Windows, PATHEXT extensions are tried.
 */
function resolveOnHostPath(command: string): string {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
      : ['']
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext)
      try {
        if (fs.statSync(candidate).isFile()) {
          fs.accessSync(candidate, fs.constants.X_OK)
          return candidate
        }
      } catch {
        // not here (missing / not executable) — keep scanning
      }
    }
  }
  return command
}
