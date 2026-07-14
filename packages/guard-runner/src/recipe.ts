/**
 * The preparation recipe (`.truecourse/scenarios/recipe.json`) — how to turn the
 * working tree into a runnable entrypoint. `build` runs once per run in the repo
 * root; `entry` (argv) is stored repo-relative and resolved to absolute at run
 * time so a sandbox in a temp dir can still invoke the built binary.
 *
 * The recipe also carries an inputs fingerprint — a hash of the files that would
 * inform discovery (package.json, the lockfile, build config). This phase records
 * the fingerprint into the run store; staleness enforcement is a later phase.
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { z } from 'zod'

export const RecipeSchema = z
  .object({
    /** Shell command run once in the repo root to produce the entrypoint. */
    build: z.string().min(1),
    /** Entrypoint argv; scenario `run` argv is appended to this. Repo-relative. */
    entry: z.array(z.string()).min(1),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict()

export type Recipe = z.infer<typeof RecipeSchema>

export interface LoadedRecipe {
  recipe: Recipe
  /** `sha256:…` over the discovery-input files present in the repo. */
  fingerprint: string
}

/** Files whose contents inform recipe discovery; the fingerprint hashes those present. */
const FINGERPRINT_INPUTS: readonly string[] = [
  'package.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'turbo.json',
]

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

/** Hash the present discovery-input files (sorted, path-tagged) into one digest. */
export function computeRecipeFingerprint(repoRoot: string): string {
  const hash = crypto.createHash('sha256')
  for (const rel of FINGERPRINT_INPUTS) {
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
