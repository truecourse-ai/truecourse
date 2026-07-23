/**
 * The api-driver seed stage. `api.seed.command` runs ONCE per guard run in the repo
 * root (sh -c) after `services.up` and BEFORE any server boots — the authenticated
 * one-shot that mints credentials and fixtures the whole run reuses. The runner sets
 * `GUARD_SEED_OUT` to a temp file the command writes its manifest JSON to:
 *
 *   { "credentials": { "<name>": { "value": "Bearer …" } },
 *     "fixtures":    { "<name>": { "<field>": <any>, … } } }
 *
 * The manifest is validated against the recipe's STATIC `provides` declaration: every
 * declared credential and every declared fixture field MUST be present (a gap is a
 * hard {@link SeedError} naming what's missing). Extra emitted keys/fields not in
 * `provides` are ignored (they are invisible to authoring anyway) with a logged
 * warning. Seeded credential values merge into the resolved credential map and are
 * redacted like any other secret; fixture values are kept in their NATIVE JSON type
 * (a manifest number stays a number) and are NOT secrets — the interpolator derives the
 * decimal-string form on demand when a fixture is spliced into a longer string, and
 * substitutes the native value when a `{{fixture:…}}` is a whole value. Manifest VALUES
 * never enter any fingerprint — only `provides` (which lives in recipe.json) does.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { constructChildEnv, BUILD_PASSTHROUGH } from '../child-env.js'
import { armChildKill } from '../child-kill.js'
import { DEFAULT_BUILD_TIMEOUT_MS } from '../build.js'
import type { RecipeApiSeed, ResolvedCredential } from '../recipe.js'
import { buildCredentialRedactor } from './redact.js'

/** The env var naming the file the seed command writes its manifest JSON to. */
export const SEED_OUT_ENV = 'GUARD_SEED_OUT'

/** How much of the seed's combined output rides a failure message (the tail is the useful part). */
const OUTPUT_TAIL = 2_000

/** `Object.prototype.hasOwnProperty` guard — never trust prototype-chain keys on parsed JSON. */
function own(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

/** A seed stage failed — a hard run stop (never a silent skip). */
export class SeedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SeedError'
  }
}

/** The resolved product of a successful seed run. */
export interface SeedResult {
  /** Declared credentials, name → header (from `provides`) + minted value (from manifest). */
  credentials: Map<string, ResolvedCredential>
  /** Declared fixtures, name → { field → native JSON value }; only DECLARED fields. */
  fixtures: Map<string, Record<string, unknown>>
}

export interface RunSeedOptions {
  repoRoot: string
  seed: RecipeApiSeed
  /**
   * The env the seed runs with (layered under the injected `GUARD_SEED_OUT`, same
   * allowlist as the build). The runner passes the SERVER's env (`recipe.env` merged
   * with `api.env`): the seed prepares state for exactly the process that env
   * describes, so a datastore URL living in `api.env` must reach the seed too.
   */
  env?: Record<string, string>
  /** Wall-clock budget; defaults to the build timeout. */
  timeoutMs?: number
  signal?: AbortSignal
  /**
   * Already-resolved recipe credential values (Phase 1 `api.credentials`), name → value.
   * Folded into the failure-message redactor so a secret the seed echoed into its output
   * before failing is masked in the `seed-failed` message (which no scenario redactor
   * covers — it is surfaced before any server boots).
   */
  knownCredentials?: ReadonlyMap<string, string>
}

/**
 * Run the seed command and resolve its manifest against the recipe's `provides`.
 * Throws {@link SeedError} on any failure — non-zero exit, missing/unparseable
 * manifest, or a declared credential/fixture-field the manifest omits. Every failure
 * message is redacted through a redactor built from BOTH the recipe-resolved credential
 * values and any values harvested from the (possibly partial) manifest, so a secret the
 * seed echoed into its output never rides the tail unmasked.
 */
export async function runSeed(opts: RunSeedOptions): Promise<SeedResult> {
  const { repoRoot, seed } = opts
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-seed-'))
  const outFile = path.join(outDir, 'manifest.json')
  try {
    const run = await spawnSeed(
      repoRoot,
      seed.command,
      { ...(opts.env ?? {}), [SEED_OUT_ENV]: outFile },
      opts.timeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS,
      opts.signal,
    )
    // Build the redactor BEFORE surfacing any tail: recipe-resolved values plus every
    // credential value we can harvest from a manifest the seed may have partially
    // written (even on a non-zero exit). Best-effort read never throws.
    const redact = buildCredentialRedactor(collectSecrets(opts.knownCredentials, outFile))
    if (run.timedOut) {
      throw new SeedError(redact(`seed command \`${seed.command}\` timed out${tail(run.output)}`))
    }
    if (run.exitCode !== 0) {
      throw new SeedError(
        redact(`seed command \`${seed.command}\` exited ${run.exitCode ?? '(killed, no exit code)'}${tail(run.output)}`),
      )
    }
    try {
      return resolveManifest(seed, readManifest(seed.command, outFile))
    } catch (e) {
      // Validation/parse messages carry names, not secrets — but redact uniformly so a
      // fixture value that happens to equal a secret can never slip through either.
      if (e instanceof SeedError) throw new SeedError(redact(e.message))
      throw e
    }
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
}

/**
 * The secrets the failure redactor masks: the recipe-resolved credential values plus
 * every string credential value found in the manifest the seed wrote (harvested
 * best-effort — a missing/garbage manifest yields nothing, never throws). Keyed by
 * credential name so the mask reads `«cred:<name>»`.
 */
function collectSecrets(known: ReadonlyMap<string, string> | undefined, outFile: string): Map<string, string> {
  const secrets = new Map<string, string>(known ?? [])
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(outFile, 'utf-8'))
    const creds = (parsed as SeedManifest | null)?.credentials
    if (creds && typeof creds === 'object') {
      for (const [name, entry] of Object.entries(creds)) {
        if (entry && typeof entry.value === 'string' && entry.value.length > 0) secrets.set(name, entry.value)
      }
    }
  } catch {
    // No manifest, or not JSON — nothing to harvest; the recipe-known values still apply.
  }
  return secrets
}

/** Parse the manifest file the seed was asked to write; absence/garbage is a hard stop. */
function readManifest(command: string, outFile: string): SeedManifest {
  if (!fs.existsSync(outFile)) {
    throw new SeedError(`seed command \`${command}\` wrote no manifest to $${SEED_OUT_ENV}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(outFile, 'utf-8'))
  } catch (e) {
    throw new SeedError(`seed manifest at $${SEED_OUT_ENV} is not valid JSON: ${e instanceof Error ? e.message : e}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SeedError(`seed manifest at $${SEED_OUT_ENV} must be a JSON object`)
  }
  return parsed as SeedManifest
}

/** The (loosely-typed) shape of the manifest JSON the seed emits. */
interface SeedManifest {
  credentials?: Record<string, { value?: unknown } | undefined>
  fixtures?: Record<string, Record<string, unknown> | undefined>
}

/** Validate the manifest against `provides` and project it to the resolved result. */
function resolveManifest(seed: RecipeApiSeed, manifest: SeedManifest): SeedResult {
  const credentials = new Map<string, ResolvedCredential>()
  const emittedCreds = manifest.credentials ?? {}
  for (const [name, decl] of Object.entries(seed.provides.credentials ?? {})) {
    const entry = own(emittedCreds, name) ? emittedCreds[name] : undefined
    const value = entry?.value
    if (typeof value !== 'string' || value.trim() === '') {
      throw new SeedError(
        `seed manifest is missing a non-blank value for declared credential "${name}" ` +
          `(expected credentials.${name}.value)`,
      )
    }
    credentials.set(name, { header: decl.header, value })
  }
  warnExtraKeys('credential', Object.keys(emittedCreds), seed.provides.credentials)

  const fixtures = new Map<string, Record<string, unknown>>()
  const emittedFixtures = manifest.fixtures ?? {}
  for (const [name, fields] of Object.entries(seed.provides.fixtures ?? {})) {
    const emitted = own(emittedFixtures, name) ? emittedFixtures[name] : undefined
    if (emitted === null || emitted === undefined || typeof emitted !== 'object' || Array.isArray(emitted)) {
      throw new SeedError(`seed manifest is missing declared fixture "${name}" (expected fixtures.${name})`)
    }
    const record: Record<string, unknown> = {}
    for (const field of fields) {
      // OWN-property check: never satisfy a declared field from the prototype chain
      // (a field named `toString`/`constructor` would otherwise capture a function).
      if (!own(emitted, field)) {
        throw new SeedError(`seed manifest fixture "${name}" is missing declared field "${field}"`)
      }
      // Kept NATIVE (numbers stay numbers) — the interpolator stringifies on demand.
      record[field] = (emitted as Record<string, unknown>)[field]
    }
    warnExtraKeys(`fixture "${name}" field`, Object.keys(emitted), Object.fromEntries(fields.map((f) => [f, true])))
    fixtures.set(name, record)
  }
  warnExtraKeys('fixture', Object.keys(emittedFixtures), seed.provides.fixtures)

  return { credentials, fixtures }
}

/** Log (never throw) a warning for emitted keys the recipe never declared. */
function warnExtraKeys(kind: string, emitted: string[], declared: Record<string, unknown> | undefined): void {
  const known = new Set(Object.keys(declared ?? {}))
  const extra = emitted.filter((k) => !known.has(k))
  if (extra.length > 0) {
    // eslint-disable-next-line no-console -- surfacing an ignored-key warning is the point.
    console.warn(`[guard seed] ignoring undeclared ${kind}(s) in the manifest: ${extra.join(', ')}`)
  }
}

/** The trailing combined output appended to a seed failure message (empty adds nothing). */
function tail(output: string): string {
  const trimmed = output.trimEnd()
  return trimmed ? `\n${trimmed.slice(-OUTPUT_TAIL)}` : ''
}

interface SeedRun {
  exitCode: number | null
  timedOut: boolean
  /** Combined stdout + stderr, in arrival order — the seed's full diagnostic voice. */
  output: string
}

/**
 * Spawn the seed command hermetically (same env allowlist as the build). BOTH stdout
 * and stderr are drained — a piped-but-unread stdout fills the OS pipe buffer (~64KB)
 * and blocks the seed's own `write()`, hanging the run until the timeout with a
 * misleading "timed out". Combined into one buffer (like `runBuild`) so a verbose seed
 * completes and its full diagnostic — on either stream — rides the failure tail.
 */
function spawnSeed(
  repoRoot: string,
  command: string,
  env: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<SeedRun> {
  if (signal?.aborted) return Promise.resolve({ exitCode: null, timedOut: false, output: '' })
  return new Promise<SeedRun>((resolve) => {
    const child = spawn(command, {
      cwd: repoRoot,
      env: constructChildEnv({ recipeEnv: env, passthrough: BUILD_PASSTHROUGH }),
      shell: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    let settled = false
    const kill = armChildKill(child, timeoutMs, signal, { processGroup: true })
    const finish = (exitCode: number | null): void => {
      if (settled) return
      settled = true
      kill.disarm()
      resolve({ exitCode, timedOut: kill.timedOut, output })
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
