/**
 * The preparation recipe (`.truecourse/scenarios/recipe.json`) — how to turn the
 * working tree into something scenarios can drive. `build` runs once per run in
 * the repo root; `entry` (argv, the cli driver's preparation) is stored
 * repo-relative and resolved to absolute at run time so a sandbox in a temp dir
 * can still invoke the built binary. The optional `api` block is the api
 * driver's preparation: how to START the built HTTP server (`serve` argv, same
 * resolution as `entry`), how to know it's ready (`healthPath` polled until
 * 2xx), and optional one-shot `services` commands for datastores the server
 * needs. The runner allocates a free port per boot and injects it as `PORT`.
 *
 * The recipe also carries an inputs fingerprint — a hash of the files that would
 * inform discovery (package.json, the lockfile, build config). This phase records
 * the fingerprint into the run store; staleness enforcement is a later phase.
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { z } from 'zod'
import { recipePath } from './store.js'

/**
 * One declared api credential: an opaque name (the map key, e.g. `api-key`) →
 * the request HEADER the runner injects it as, plus its source — exactly one of a
 * literal `value` or a `valueFromEnv` env-var name resolved from the host process
 * at run start. Scenarios reference the credential by placing `{{cred:<name>}}` in
 * a header value; the runner substitutes the resolved secret at request time and
 * masks it back out of every evidence transcript.
 */
export const RecipeApiCredentialSchema = z
  .object({
    /** The request header the credential is injected as (advertised to authoring). */
    header: z.string().min(1),
    /** A literal secret value (kept out of every hash — a rotation never re-plans). */
    value: z.string().min(1).optional(),
    /** Host env-var name the value is read from at run start (missing → hard error). */
    valueFromEnv: z.string().min(1).optional(),
  })
  .strict()
  .refine((c) => (c.value !== undefined) !== (c.valueFromEnv !== undefined), {
    message: 'a credential carries exactly one of `value` or `valueFromEnv`',
  })

/** The api driver's preparation layer — how to boot + health-check the server. */
export const RecipeApiSchema = z
  .object({
    /** Argv that starts the HTTP server (resolved like `entry`). The runner sets `PORT`. */
    serve: z.array(z.string()).min(1),
    /** Health endpoint polled until it returns 2xx. Defaults to `/`. */
    healthPath: z.string().regex(/^\//, 'healthPath must start with /').optional(),
    /** Wall-clock budget for the server to become healthy. Defaults to 30s. */
    readyTimeoutMs: z.number().int().positive().optional(),
    /** Extra env for the server process (on top of the recipe-level `env`). */
    env: z.record(z.string(), z.string()).optional(),
    /**
     * One-shot datastore orchestration, run in the repo root once per run:
     * `up` before any api scenario, `down` (optional) after the last one.
     * The runner does no orchestration itself — these are the repo's own commands
     * (e.g. `docker compose up -d db`).
     */
    services: z
      .object({ up: z.string().min(1), down: z.string().min(1).optional() })
      .strict()
      .optional(),
    /**
     * Named request-header credentials the runner injects into scenario steps that
     * reference `{{cred:<name>}}`. Names are opaque identifiers; values are never
     * authored into scenarios and never enter any fingerprint.
     */
    credentials: z.record(z.string().min(1), RecipeApiCredentialSchema).optional(),
  })
  .strict()

export const RecipeSchema = z
  .object({
    /** Optional shell command run once in the repo root, before every build, to fetch dependencies. */
    install: z.string().min(1).optional(),
    /** Shell command run once in the repo root to produce the entrypoint/server. */
    build: z.string().min(1),
    /** Entrypoint argv (cli driver); scenario `run` argv is appended to this. Repo-relative. */
    entry: z.array(z.string()).min(1).optional(),
    env: z.record(z.string(), z.string()).optional(),
    /** The api driver's preparation layer; present when the repo has api scenarios. */
    api: RecipeApiSchema.optional(),
  })
  .strict()
  .refine((r) => r.entry !== undefined || r.api !== undefined, {
    message: 'recipe needs an `entry` (cli driver) and/or an `api` block (api driver)',
  })

export type RecipeApiCredential = z.infer<typeof RecipeApiCredentialSchema>
export type RecipeApi = z.infer<typeof RecipeApiSchema>
export type Recipe = z.infer<typeof RecipeSchema>

/** A credential resolved to its concrete secret at run start. */
export interface ResolvedCredential {
  header: string
  value: string
}

/** A declared credential referenced a host env var that is not set at run time. */
export class CredentialResolutionError extends Error {}

/**
 * Resolve every declared api credential to its concrete secret at run start:
 * inline `value`s pass through; `valueFromEnv` reads the host process env, and a
 * missing var is a hard {@link CredentialResolutionError} (never a silent skip —
 * an api scenario referencing the credential would otherwise run un-authenticated).
 * The returned map is keyed by credential name; values never enter any fingerprint.
 */
export function resolveApiCredentials(
  credentials: Record<string, RecipeApiCredential> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Map<string, ResolvedCredential> {
  const resolved = new Map<string, ResolvedCredential>()
  for (const [name, cred] of Object.entries(credentials ?? {})) {
    let value: string
    if (cred.value !== undefined) {
      value = cred.value
    } else {
      const fromEnv = env[cred.valueFromEnv!]
      // Unset OR set-but-blank both fail loudly — a blank secret would inject an
      // empty header and run un-authenticated, and the redactor has nothing to mask.
      // This mirrors the schema's `min(1)` floor on an inline `value`.
      if (fromEnv === undefined || fromEnv.trim() === '') {
        throw new CredentialResolutionError(
          `credential "${name}" reads its value from env var ${cred.valueFromEnv}, which is ${fromEnv === undefined ? 'not set' : 'set but empty'}`,
        )
      }
      value = fromEnv
    }
    resolved.set(name, { header: cred.header, value })
  }
  return resolved
}

/** Default health path polled on the booted api server. */
export const DEFAULT_API_HEALTH_PATH = '/'
/** Default wall-clock budget for the api server to become healthy. */
export const DEFAULT_API_READY_TIMEOUT_MS = 30_000

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
  // Fold the recipe file itself so a recipe edit (its serve argv, health path, or
  // the DECLARED credential capability set — names + headers + env sources) re-keys
  // every section that generates against it. Credential VALUES are stripped first so
  // a rotated secret never re-plans, and a secret never enters the fingerprint.
  const recipeAbs = recipePath(repoRoot)
  if (fs.existsSync(recipeAbs) && fs.statSync(recipeAbs).isFile()) {
    hash.update('recipe.json')
    hash.update('\0')
    hash.update(hashableRecipeText(fs.readFileSync(recipeAbs, 'utf-8')))
    hash.update('\0')
  }
  return `sha256:${hash.digest('hex')}`
}

/**
 * The recipe text folded into the fingerprint: a CANONICAL JSON re-serialization
 * (object keys recursively sorted, so a pure key reordering does not re-plan) with
 * every credential's inline `value` stripped, so the capability set (names, headers,
 * env sources) drives staleness while a rotated secret does not — and no secret ever
 * reaches the digest. Unparseable JSON is hashed verbatim (a malformed recipe fails
 * the run regardless, and carries no schema-valid credential to leak).
 */
function hashableRecipeText(raw: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return raw
  }
  const creds = (parsed as { api?: { credentials?: Record<string, unknown> } })?.api?.credentials
  if (creds && typeof creds === 'object') {
    for (const cred of Object.values(creds)) {
      if (cred && typeof cred === 'object' && 'value' in cred) {
        delete (cred as Record<string, unknown>).value
      }
    }
  }
  return JSON.stringify(canonicalizeJson(parsed))
}

/** Recursively sort object keys (arrays keep order — argv order is meaningful) so
 *  the recipe fingerprint is invariant to JSON key ordering. */
function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalizeJson((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
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
