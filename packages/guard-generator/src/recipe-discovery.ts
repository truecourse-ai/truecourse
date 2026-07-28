/**
 * Recipe discovery — a DETERMINISTIC proposer first, an LLM proposer as the
 * fallback, and the same engine verification over both. `recipe-propose.ts` reads
 * the repo's own declarations (manifests, lockfiles, scripts, the route surface)
 * and, when they decide the answer, proposes without a model call; only when it
 * refuses — or when what it proposed fails verification — does the model propose
 * `{build, entry and/or api}`. Either way the ENGINE runs the install and build,
 * probes the cli entrypoint, and boots the api server to its health path, and only
 * a proposal that actually builds and answers is written to `recipe.json`. The
 * model never executes anything. Skipped entirely when a (human-reviewed,
 * committable) `recipe.json` already exists.
 *
 * A rejected MODEL proposal gets ONE evidence retry — the same house pattern as
 * authoring's birth-evidence re-author and extraction's corrective re-ask: the
 * engine's own verification diagnostic goes back to the model verbatim and the
 * replacement proposal is verified in full, from install onwards. A rejected
 * DETERMINISTIC proposal is never retried deterministically (the detectors would
 * derive exactly the same thing) — its diagnostic rides into the model's first
 * call as the same evidence context, so the model starts from what failed.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { getCacheEntry, setCacheEntry } from '@truecourse/llm'
import {
  loadRecipe,
  resolveEntry,
  runBuild,
  runInstall,
  computeRecipeFingerprint,
  recipePath,
  executeStep,
  missingEntryScript,
  formatMissingEntryScript,
  constructChildEnv,
  preflightApiServer,
  DEFAULT_API_HEALTH_PATH,
  DEFAULT_API_READY_TIMEOUT_MS,
  BUILD_PASSTHROUGH,
  type Recipe,
} from '@truecourse/guard-runner'
import { RecipeProposalSchema, type RecipeProposal } from './schemas.js'
import { RECIPE_PROMPT_FINGERPRINT, type RecipeDiscoveryInput, type RecipeRetryContext } from './prompts.js'
import { flattenZodError, quoteInvalidOutput } from './validate.js'
import { proposeRecipe, type ApiRouteRef } from './recipe-propose.js'
import type { RecipeRunner } from './runners.js'

export const RECIPE_CACHE_NAME = 'guard/recipe'

/** Files whose presence + content inform recipe discovery (mirrors the runner's set). */
const DISCOVERY_INPUTS = ['package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'turbo.json']

/** How long the engine's verification install, build, and entrypoint probe may take. */
const INSTALL_TIMEOUT_MS = 600_000
const BUILD_TIMEOUT_MS = 600_000
const PROBE_TIMEOUT_MS = 30_000

/** Which proposer produced the recipe that verified. */
export type RecipeDiscoverySource = 'deterministic' | 'llm'

export type RecipeDiscoveryResult =
  | { status: 'exists'; recipe: Recipe; fingerprint: string }
  | {
      status: 'discovered'
      recipe: Recipe
      fingerprint: string
      wrotePath: string
      /** How it was proposed — a deterministic recipe cost no LLM call. */
      source: RecipeDiscoverySource
      /** Human fill-ins the recipe could not decide (credential env vars, unmappable
       *  security schemes). Always empty for an LLM proposal, which proposes none. */
      todos: string[]
    }
  // `proposal` is absent when the model never produced a valid one (invalid output
  // after one corrective re-ask, or a thrown call) — there's nothing to show.
  | { status: 'verify-failed'; reason: string; proposal?: RecipeProposal }

/** Discovery's optional inputs — everything the deterministic proposer can use but
 *  must not derive itself. */
export interface DiscoverRecipeOptions {
  /**
   * The derived api route surface, resolved lazily so a repo that already HAS a
   * recipe never pays for it. Feeds the health-path ranking only; absent, the
   * proposal simply carries no `healthPath` (the runner's `/` default).
   */
  routes?: () => Promise<readonly ApiRouteRef[]>
  /**
   * Re-derive even when `recipe.json` already exists (`guard recipe --refresh`).
   * Not a "force write": discovery still writes only a proposal that VERIFIED, so
   * a refresh that fails leaves the existing recipe exactly as it was. Never set
   * by `guard generate`, which must reuse the committed, human-reviewed recipe.
   */
  ignoreExisting?: boolean
}

function recipeCacheKey(inputsFingerprint: string): string {
  return createHash('sha256').update(`${RECIPE_PROMPT_FINGERPRINT}::${inputsFingerprint}`).digest('hex')
}

/**
 * Return the current recipe when present; otherwise propose one, verify it builds
 * and its entrypoint answers, write it, and return it. A rejected proposal buys ONE
 * retry carrying the verification report; `verify-failed` then carries the LAST
 * proposal the engine ran and its report, so the caller shows what was tried.
 */
export async function discoverRecipe(
  repoRoot: string,
  runner: RecipeRunner,
  options: DiscoverRecipeOptions = {},
): Promise<RecipeDiscoveryResult> {
  const existing = options.ignoreExisting ? null : loadRecipe(repoRoot, recipePath(repoRoot))
  if (existing) return { status: 'exists', recipe: existing.recipe, fingerprint: existing.fingerprint }

  // The deterministic pass. Everything it proposes goes through the SAME
  // verification the model's proposals do — it is a cheaper proposer, not a
  // shortcut past the engine. A proposal that fails verification is NOT retried
  // deterministically (the detectors are pure, so they would derive it again);
  // its diagnostic becomes the model's opening evidence instead.
  let deterministicEvidence: RecipeRetryContext | undefined
  const derived = proposeRecipe(repoRoot, { routes: options.routes ? [...(await options.routes())] : undefined })
  if (derived.ok) {
    const verdict = await verifyProposal(repoRoot, derived.recipe)
    if (verdict.ok) {
      return {
        status: 'discovered',
        recipe: derived.recipe,
        ...writeRecipeFile(repoRoot, derived.recipe),
        source: 'deterministic',
        todos: derived.todos,
      }
    }
    deterministicEvidence = {
      proposal: JSON.stringify(derived.recipe, null, 2),
      failure: `a recipe derived from the repository's own ${derived.ecosystem} manifests failed verification: ${verdict.reason}`,
    }
  }

  const inputsFingerprint = computeRecipeFingerprint(repoRoot)
  const inputs = readDiscoveryInputs(repoRoot)

  // The LLM proposal is cached on the discovery-input fingerprint — unchanged
  // inputs reuse the prior proposal, but verification always re-runs.
  let proposal: RecipeProposal | null = null
  const cached = await getCacheEntry(repoRoot, RECIPE_CACHE_NAME, recipeCacheKey(inputsFingerprint))
  if (cached) {
    const parsed = RecipeProposalSchema.safeParse(cached)
    if (parsed.success) proposal = parsed.data
  }
  if (!proposal) {
    const attempt = await proposeRecipeWithReask(inputs, runner, deterministicEvidence)
    if ('error' in attempt) return { status: 'verify-failed', reason: attempt.error }
    proposal = attempt.proposal
    await setCacheEntry(repoRoot, RECIPE_CACHE_NAME, recipeCacheKey(inputsFingerprint), proposal)
  }

  let verdict = await verifyProposal(repoRoot, proposal)
  if (!verdict.ok) {
    // ONE evidence retry. The engine hands back its OWN verification report,
    // verbatim, and re-verifies whatever comes back — in full, from install
    // onwards. Nothing here reads the report: install, build, entry-file, and
    // entrypoint failures are one path, so a new failure kind needs no new code.
    const retried = await proposeRecipeWithReask(inputs, runner, {
      proposal: JSON.stringify(proposal, null, 2),
      failure: verdict.reason,
    })
    // A retry that yields no valid proposal (no transport, a thrown call, output
    // still invalid after its re-ask) leaves the original diagnostic untouched —
    // exactly the failure the caller would have surfaced without a retry.
    if (!('error' in retried)) {
      proposal = retried.proposal
      verdict = await verifyProposal(repoRoot, proposal)
      // The retry never gets a cache key of its own: a proposal that verified
      // REPLACES the rejected one under the round-1 key, so a later discovery over
      // the same inputs reuses what actually worked instead of re-paying the retry.
      if (verdict.ok) await setCacheEntry(repoRoot, RECIPE_CACHE_NAME, recipeCacheKey(inputsFingerprint), proposal)
    }
  }
  if (!verdict.ok) return { status: 'verify-failed', reason: verdict.reason, proposal }

  const recipe: Recipe = {
    ...(proposal.install ? { install: proposal.install } : {}),
    build: proposal.build,
    ...(proposal.entry ? { entry: proposal.entry } : {}),
    ...(proposal.env ? { env: proposal.env } : {}),
    // The proposed api block is a subset of the runner's `api` schema, so it is
    // written through as-is; the richer fields (credentials, seed, services) are
    // never model-proposed.
    ...(proposal.api ? { api: proposal.api } : {}),
  }
  return { status: 'discovered', recipe, ...writeRecipeFile(repoRoot, recipe), source: 'llm', todos: [] }
}

/** Write the verified recipe and report where it landed + the fingerprint it now
 *  carries — the one place a recipe reaches disk, shared by both proposers. */
function writeRecipeFile(repoRoot: string, recipe: Recipe): { fingerprint: string; wrotePath: string } {
  const target = recipePath(repoRoot)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(recipe, null, 2) + '\n')
  return { fingerprint: computeRecipeFingerprint(repoRoot), wrotePath: path.relative(repoRoot, target) }
}

/** One proposal's deterministic verdict: it verified, or the engine's report on why not. */
type ProposalVerdict = { ok: true } | { ok: false; reason: string }

/**
 * What verification READS — the fields both proposal shapes share. Structural, so
 * the model's `RecipeProposal` and the deterministic proposer's full `Recipe` (with
 * its `services` / `credentials`, which no boot check needs) verify through the
 * exact same path.
 */
type VerifiableProposal = {
  install?: string
  build: string
  entry?: readonly string[]
  env?: Record<string, string>
  api?: { serve: readonly string[]; healthPath?: string; env?: Record<string, string> }
}

/**
 * Verify ONE proposal end to end, in the order the runner will use it: install,
 * build, the post-build entry-file existence check, then the entrypoint probe.
 * Every rejection returns the engine's report — the text the caller surfaces AND
 * the evidence the retry quotes back, so both read the same story.
 */
async function verifyProposal(repoRoot: string, proposal: VerifiableProposal): Promise<ProposalVerdict> {
  // The optional install step runs BEFORE the verification build, exactly as the
  // runner will run it — a proposal whose install fails is never written.
  if (proposal.install) {
    const install = await runInstall(repoRoot, proposal.install, proposal.env, INSTALL_TIMEOUT_MS)
    if (!install.ok) {
      const tail = install.output.trimEnd().split('\n').slice(-5).join(' / ')
      return {
        ok: false,
        reason: `install \`${proposal.install}\` failed${install.timedOut ? ' (timed out)' : ''}: ${tail}`,
      }
    }
  }

  const build = await runBuild(repoRoot, proposal.build, proposal.env, BUILD_TIMEOUT_MS)
  if (!build.ok) {
    const tail = build.output.trimEnd().split('\n').slice(-5).join(' / ')
    return {
      ok: false,
      reason: `build \`${proposal.build}\` failed${build.timedOut ? ' (timed out)' : ''}: ${tail}`,
    }
  }

  // The cli half — verified only when the proposal prepares the cli driver. An
  // api-only proposal has no entry to check and must NEVER reach `probeEntry`: the
  // probe waits for the process to EXIT, and a server never does (it would burn the
  // probe timeout twice and then reject a perfectly good recipe).
  if (proposal.entry) {
    // Deterministic post-build check: the proposed entry's script file must EXIST
    // after the build ran. A file-existence check, no output parsing — it catches the
    // proposal naming `dist/cli.js` where the build produced `dist/cli.mjs` loudly,
    // listing what WAS found next to the missing path so the mixup is one glance.
    const missing = missingEntryScript(repoRoot, proposal.entry)
    if (missing) return { ok: false, reason: `after \`${proposal.build}\`, ${formatMissingEntryScript(missing)}` }

    const probe = await probeEntry(repoRoot, proposal.entry)
    if (!probe.ok) return { ok: false, reason: probe.reason }
  }

  // The api half — the server's analog of the entry probe: boot the proposed
  // `serve` argv in a throwaway sandbox and wait for its health path, through the
  // SAME `preflightApiServer` the runner gates every api run with, so a proposal
  // that verifies here is one the runner can actually start. Its failure text
  // already carries the server's captured startup output.
  if (proposal.api) {
    const boot = await preflightApiServer({
      resolvedServe: resolveEntry(repoRoot, proposal.api.serve),
      displayServe: proposal.api.serve,
      recipeEnv: { ...(proposal.env ?? {}), ...(proposal.api.env ?? {}) },
      healthPath: proposal.api.healthPath ?? DEFAULT_API_HEALTH_PATH,
      readyTimeoutMs: DEFAULT_API_READY_TIMEOUT_MS,
    })
    if (!boot.ok) {
      return { ok: false, reason: `api server \`${proposal.api.serve.join(' ')}\` did not start: ${boot.stderr}` }
    }
  }
  return { ok: true }
}

/**
 * Ask for a recipe proposal and validate it; on a schema failure re-ask ONCE with
 * the invalid output quoted back, then validate again. A thrown call is not
 * re-asked. `retry` carries a rejected proposal's verification evidence, and rides
 * on both the call and its corrective re-ask. Returns `{ error }` on a
 * still-invalid or thrown call — the caller turns it into `verify-failed`, never a
 * crash.
 */
async function proposeRecipeWithReask(
  input: RecipeDiscoveryInput,
  runner: RecipeRunner,
  retry?: RecipeRetryContext,
): Promise<{ proposal: RecipeProposal } | { error: string }> {
  const base: RecipeDiscoveryInput = retry ? { ...input, retry } : input
  let raw: unknown
  try {
    raw = await runner(base)
  } catch (e) {
    return { error: `recipe proposal call failed: ${(e as Error).message}` }
  }
  const parsed = RecipeProposalSchema.safeParse(raw)
  if (parsed.success) return { proposal: parsed.data }

  let reRaw: unknown
  try {
    reRaw = await runner({ ...base, correction: { invalidOutput: quoteInvalidOutput(raw) } })
  } catch (e) {
    return { error: `recipe proposal re-ask failed: ${(e as Error).message}` }
  }
  const reParsed = RecipeProposalSchema.safeParse(reRaw)
  if (reParsed.success) return { proposal: reParsed.data }
  return { error: `recipe proposal invalid after re-ask: ${flattenZodError(reParsed.error)}` }
}

function readDiscoveryInputs(repoRoot: string): { packageJson: string; presentInputs: string[] } {
  const pkgPath = path.join(repoRoot, 'package.json')
  const packageJson = fs.existsSync(pkgPath) ? fs.readFileSync(pkgPath, 'utf-8') : '(no package.json)'
  const presentInputs = DISCOVERY_INPUTS.filter((f) => fs.existsSync(path.join(repoRoot, f)))
  return { packageJson, presentInputs }
}

/**
 * Probe the proposed entrypoint: spawn it with `--help`, then bare (no args), in a
 * throwaway cwd. It "answers" if it spawns and exits within the timeout — a
 * non-zero exit (usage error) still proves the binary runs; only a spawn failure
 * or a hang counts as a failed entrypoint.
 */
async function probeEntry(
  repoRoot: string,
  entry: readonly string[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const resolved = resolveEntry(repoRoot, entry)
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-probe-'))
  try {
    for (const args of [['--help'], []]) {
      const capture = await executeStep({
        argv: [...resolved, ...args],
        cwd,
        env: constructChildEnv({ passthrough: BUILD_PASSTHROUGH }),
        timeoutMs: PROBE_TIMEOUT_MS,
      })
      if (!capture.spawnError && !capture.timedOut) return { ok: true }
    }
    return {
      ok: false,
      reason: `entrypoint ${JSON.stringify(entry)} did not answer to \`--help\` or a bare invocation`,
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
}
