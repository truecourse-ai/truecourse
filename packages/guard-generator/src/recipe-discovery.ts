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
  DEFAULT_BUILD_TIMEOUT_MS,
  computeRecipeFingerprint,
  recipePath,
  executeStep,
  missingEntryScript,
  formatMissingEntryScript,
  constructChildEnv,
  preflightApiServer,
  buildRouteManifest,
  DEFAULT_API_HEALTH_PATH,
  DEFAULT_API_READY_TIMEOUT_MS,
  DEFAULT_WEB_HEALTH_PATH,
  DEFAULT_WEB_READY_TIMEOUT_MS,
  BUILD_PASSTHROUGH,
  type Recipe,
  type RouteManifestApp,
} from '@truecourse/guard-runner'
import type { DatastoreUrlRef } from '@truecourse/shared'
import { RecipeProposalSchema, type RecipeProposal } from './schemas.js'
import {
  RECIPE_PROMPT_FINGERPRINT,
  type RecipeAppInventoryEntry,
  type RecipeDiscoveryInput,
  type RecipeRetryContext,
} from './prompts.js'
import { flattenZodError, quoteInvalidOutput } from './validate.js'
import {
  proposeRecipe,
  detectEcosystems,
  DEV_SCRIPT_MARKERS,
  SHELL_OPERATORS,
  type ApiRouteRef,
} from './recipe-propose.js'
import { GUARD_COMPOSE_FILE, type ComposePlan } from './datastore-compose.js'
import type { RecipeRunner } from './runners.js'

export const RECIPE_CACHE_NAME = 'guard/recipe'

/** Manifest/lockfiles whose presence + content the model proposer is shown. A subset
 *  of the runner's fingerprint inputs: guard's OWN generated compose file is not a
 *  fact about the repo the model should propose from. */
const DISCOVERY_INPUTS = ['package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'turbo.json']

/** How long the engine's verification install, build, and entrypoint probe may take. */
const INSTALL_TIMEOUT_MS = 600_000
const BUILD_TIMEOUT_MS = 600_000
const PROBE_TIMEOUT_MS = 30_000
/** The services bring-up bound — the SAME one `run.ts` gives `api.services.up`
 *  (it runs it through `runBuild` with the run's build timeout), so a compose
 *  pull that is slow but fine at run time is not called hung here. */
const SERVICES_TIMEOUT_MS = DEFAULT_BUILD_TIMEOUT_MS

/** Which proposer produced the recipe that verified. */
export type RecipeDiscoverySource = 'deterministic' | 'llm'

/** The steps verification runs, in order — each one names itself in its diagnostic
 *  and in the progress phase, so a reader never has to guess which one is running.
 *  `static` is stage zero: the free refusal rules, rejected before anything runs. */
export type RecipeVerifyStage = 'static' | 'install' | 'build' | 'entry probe' | 'services' | 'server boot' | 'web boot'

/**
 * What discovery is doing RIGHT NOW. Everything here is minutes-long (an install, a
 * build, a server boot) or a model call, which is why it is reported at all. A plain
 * callback payload, not a tracker: this package must not depend on
 * `@truecourse/core`, so the command layer adapts it.
 */
export type RecipeDiscoveryPhase =
  /** The MODEL is producing a proposal — the only proposer that costs wall time; the
   *  deterministic one reads manifests and returns. `after` names the stage the
   *  previous proposal died on, so it is present exactly on a revision. */
  | { kind: 'proposing'; after?: RecipeVerifyStage }
  /** The engine is running a proposal. `revision` marks a re-verification OF THE SAME
   *  PROPOSER — the model's opening attempt is never one, even when the deterministic
   *  proposal was verified and rejected before it. */
  | { kind: 'verifying'; stage: RecipeVerifyStage; revision: boolean; server?: string }

/** Which proposer a verification belongs to — the unit `revision` is measured over. */
type RecipeProposalLineage = 'deterministic' | 'model'

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
      /** The generated datastore compose file, repo-root-relative, when
       *  discovery wrote one alongside the recipe. Both are artifacts to review. */
      composePath?: string
      /** The sessions-store run the repair session ran under, when one did. */
      sessionRunId?: string
    }
  // `proposal` is absent when the model never produced a valid one (invalid output
  // after one corrective re-ask, or a thrown call) — there's nothing to show.
  | { status: 'verify-failed'; reason: string; proposal?: RecipeProposal; sessionRunId?: string }

// ---------------------------------------------------------------------------
// The repair seam (plan 03 step 9) — the agent session that replaced the
// one-shot LLM fallback. Defined HERE (driver-agnostic types only) because the
// session itself lives in `@truecourse/core`, which this package must not
// depend on: core builds a `RecipeRepairFn` and injects it.
// ---------------------------------------------------------------------------

/** Everything the repair session's briefing states — the failed proposal, the
 *  engine's own verdict, and the deterministic evidence discovery already has. */
export interface RecipeRepairContext {
  repoRoot: string
  /** What the model proposer used to read: the root manifest + the app inventory. */
  inputs: { packageJson: string; presentInputs: string[]; apps?: RecipeAppInventoryEntry[] }
  /** `computeRecipeFingerprint(repoRoot)` at repair time — the cache key input. */
  inputsFingerprint: string
  /** The deterministic proposal the engine RAN and rejected, when one was tried. */
  failed?: { proposal: string; stage: RecipeVerifyStage; reason: string }
  /** The detected datastore dependency, when the analysis pass saw one. */
  database: DatabaseDependencyHint | null
  /** The datastore connection URLs the app's own source declares. */
  datastoreUrls: readonly DatastoreUrlRef[]
  /**
   * True when discovery already GENERATED a compose datastore, verified it with
   * the deterministic proposal, and reverted it — the session must be told, so
   * it never re-advises what guard just tried.
   */
  composeGenerated: boolean
}

/** What the seam hands back: a proposal to fold-verify, or why there is none. */
export type RecipeRepairResult =
  | { proposal: RecipeProposal; sessionRunId?: string }
  | { error: string; sessionRunId?: string }

export type RecipeRepairFn = (ctx: RecipeRepairContext) => Promise<RecipeRepairResult>

/** What the caller's analysis pass knows about the repo's datastore — the two
 *  fields the diagnostic names. A `null` provider result means "nothing detected". */
export interface DatabaseDependencyHint {
  /** The datastore family (`postgres`, `mysql`, `sqlite`, …). */
  type: string
  /** The ORM/driver the analyzer matched (`drizzle-orm`, `pg`, `prisma`, …). */
  driver: string
}

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
   * The repo's detected datastore dependency, resolved lazily and ONLY when a boot
   * verification failed — the same seam `routes` rides (the caller's memoized
   * journey-mapping pass, never a second analysis). Present, and the proposal
   * declares no `api.services`, the boot failure is reported as a datastore story
   * with what to do about it instead of a bare stack trace.
   */
  database?: () => Promise<DatabaseDependencyHint | null>
  /**
   * The datastore connection URLs the app declares in its source, off the
   * SAME memoized analysis pass `routes` rides. Resolved with `routes` (before the
   * deterministic proposal, which needs them) and used only when the repo ships no
   * compose datastore of its own: the proposer then GENERATES one. Absent ⇒ nothing
   * is generated and a datastore repo gets the guided failure it got before.
   */
  datastores?: () => Promise<readonly DatastoreUrlRef[]>
  /**
   * Re-derive even when `recipe.json` already exists (`guard recipe --refresh`).
   * Not a "force write": discovery still writes only a proposal that VERIFIED, so
   * a refresh that fails leaves the existing recipe exactly as it was. Never set
   * by `guard generate`, which must reuse the committed, human-reviewed recipe.
   */
  ignoreExisting?: boolean
  /**
   * Fires as discovery enters each long phase — the install, the build, the probe,
   * the boot, and the model calls between them. Discovery is the slowest thing
   * `guard setup` does and every part of it is silent, so a caller with a progress
   * surface subscribes here; without one, nothing changes.
   */
  onPhase?: (phase: RecipeDiscoveryPhase) => void
  /**
   * THE REPAIR SESSION (plan 03 step 9). When present it REPLACES the one-shot
   * `proposeRecipeWithReask` + evidence-retry fallback: discovery hands the seam
   * the failed proposal, the engine's verdict, and the deterministic evidence,
   * and fold-verifies whatever comes back with `verifyProposal` REGARDLESS of
   * what the session's transcript claims — the gate of record stays here. The
   * seam owns its own caching (`guard/recipe`, same name+key as the legacy
   * path, via the session cache); discovery's own cache read/write is bypassed
   * so the entry is written exactly once. Absent ⇒ today's one-shot behavior,
   * byte for byte (hosted `guard generate` and the test seams ride that path).
   */
  repair?: RecipeRepairFn
}

/** The `guard/recipe` cache key — `sha256(prompt fp :: discovery-input fp)`.
 *  Exported so the repair session keeps the exact key (plan 03 step 9): a
 *  proposal the one-shot era settled stays a hit in the session era. */
export function recipeCacheKey(inputsFingerprint: string): string {
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

  // A repo declaring NO recognized manifest is a hard stop, taken BEFORE any spend.
  // There is nothing for either proposer to read, so the model would be asked to
  // invent a build command and an entrypoint against an empty tree — and whatever
  // it invented would then be verified, built and probed. Refusing is both cheaper
  // and truer: the answer has to come from the user, as a hand-written recipe.
  // (An ambiguous manifest is the opposite case: the model has real material and
  // the deterministic proposer's own diagnostic rides along as its evidence.)
  if (detectEcosystems(repoRoot).length === 0) {
    return {
      status: 'verify-failed',
      reason:
        `${path.basename(repoRoot)} declares no manifest guard can read — no package.json (JS/TS), ` +
        'pyproject.toml / setup.py / setup.cfg / requirements.txt (Python), or .csproj/.sln (C#) at the repo root. ' +
        'Nothing describes how to build or start this project, so no recipe can be derived. ' +
        'Write `.truecourse/scenarios/recipe.json` by hand (a `build` command plus an `entry` argv and/or an `api` block), then re-run.',
    }
  }

  // The deterministic pass. Everything it proposes goes through the SAME
  // verification the model's proposals do — it is a cheaper proposer, not a
  // shortcut past the engine. A proposal that fails verification is NOT retried
  // deterministically (the detectors are pure, so they would derive it again);
  // its diagnostic becomes the model's opening evidence instead.
  let deterministicEvidence: RecipeRetryContext | undefined
  /** The deterministic proposal's own verification report, kept so an unreachable
   *  model fallback cannot bury it. */
  let deterministicFailure: string | undefined
  /** The stage it died on — what the model's first call is a revision AFTER. */
  let deterministicStage: RecipeVerifyStage | undefined
  // The datastore hint is resolved at most ONCE per discovery and only when a boot
  // failed — memoized here so the deterministic proposal and the model's retries
  // share one answer (and one analysis pass).
  let databaseOnce: Promise<DatabaseDependencyHint | null> | null = null
  // Read once, before the deterministic pass: the model briefing needs it later,
  // and the static inventory rule holds EVERY proposal to it from the start.
  const inputs = readDiscoveryInputs(repoRoot)
  const verifyContext: VerifyContext = {
    ...(options.database
      ? { database: () => (databaseOnce ??= Promise.resolve(options.database!()).catch(() => null)) }
      : {}),
    ...(inputs.apps ? { apps: inputs.apps } : {}),
  }
  // Verification reports the STAGE it is in; whether that is a re-verification is
  // discovery's own knowledge, so it is added on the way out. Built per call so each
  // round sees whatever `verifyContext` has learned by then (`composeGenerated`).
  //
  // `revision` is per PROPOSAL LINEAGE, not a global round counter: the deterministic
  // proposer consumes the first round, so counting rounds would render the model's
  // opening attempt as `re-verifying: build` — claiming the engine is retrying a
  // proposer whose first proposal it has not verified yet.
  let verifiedLineage: RecipeProposalLineage | null = null
  const verifying = (lineage: RecipeProposalLineage): VerifyContext => {
    const revision = verifiedLineage === lineage
    verifiedLineage = lineage
    return {
      ...verifyContext,
      ...(options.onPhase
        ? { onPhase: (p) => options.onPhase?.({ kind: 'verifying', revision, ...p }) }
        : {}),
    }
  }
  const derived = proposeRecipe(repoRoot, {
    routes: options.routes ? [...(await options.routes())] : undefined,
    datastores: options.datastores ? [...(await options.datastores())] : undefined,
    ...(inputs.manifestApps ? { manifestApps: inputs.manifestApps } : {}),
  })
  if (derived.ok) {
    // The generated datastore must be ON DISK before verification: the `services.up`
    // command references it by path. It is written, verified with the rest of the
    // proposal, and put back exactly as it was if the proposal fails — the same
    // write-then-restore rule the drafted seed follows, so a refused run leaves the
    // tree byte-identical.
    const compose = derived.compose ? writeComposeFile(repoRoot, derived.compose) : null
    const verdict = await verifyProposal(repoRoot, derived.recipe, verifying('deterministic'))
    if (verdict.ok) {
      return {
        status: 'discovered',
        recipe: derived.recipe,
        ...writeRecipeFile(repoRoot, derived.recipe),
        source: 'deterministic',
        todos: [...derived.todos, ...(verdict.warnings ?? [])],
        ...(compose ? { composePath: compose.rel } : {}),
      }
    }
    compose?.revert()
    // Every LATER verification in this discovery (the model's proposals, which can
    // carry no `services` at all) now knows a generated datastore was already tried
    // and did not work — so the guided failure never advises what guard just did.
    if (compose) verifyContext.composeGenerated = true
    deterministicFailure = verdict.reason
    deterministicStage = verdict.stage
    deterministicEvidence = {
      proposal: JSON.stringify(derived.recipe, null, 2),
      failure: `a recipe derived from the repository's own ${derived.ecosystem} manifests failed verification: ${verdict.reason}`,
    }
  }

  const inputsFingerprint = computeRecipeFingerprint(repoRoot)

  // ---- The repair session path (plan 03 step 9). -----------------------------
  // Loop ONLY on the failure path: a deterministic proposal that verified never
  // reaches here, so a clean repo spends zero sessions. The session frames the
  // work as repair-to-green (the failed proposal + the engine's verdict lead its
  // briefing) and iterates in its own working sandbox; the proposal it settles on
  // is fold-verified HERE, in a fresh verification pass, whatever its transcript
  // showed — the session's `verify_recipe` tool is its done-check, not the gate.
  if (options.repair) {
    const database = options.database ? await Promise.resolve(options.database()).catch(() => null) : null
    const datastoreUrls = options.datastores ? await options.datastores() : []
    options.onPhase?.({ kind: 'proposing', ...(deterministicStage ? { after: deterministicStage } : {}) })
    const repaired = await options.repair({
      repoRoot,
      inputs,
      inputsFingerprint,
      ...(deterministicEvidence && deterministicStage
        ? {
            failed: {
              proposal: deterministicEvidence.proposal,
              stage: deterministicStage,
              reason: deterministicFailure ?? deterministicEvidence.failure,
            },
          }
        : {}),
      database,
      datastoreUrls,
      composeGenerated: verifyContext.composeGenerated === true,
    })
    const sessionRunId = repaired.sessionRunId
    if ('error' in repaired) {
      // Same precedence rule as an unreachable one-shot model: the engine's own
      // deterministic diagnostic leads, the session failure is the footnote.
      return {
        status: 'verify-failed',
        reason: deterministicFailure
          ? `${deterministicFailure}\n\n(the repair session could not settle a proposal: ${repaired.error})`
          : repaired.error,
        ...(sessionRunId ? { sessionRunId } : {}),
      }
    }
    const repairedVerdict = await verifyProposal(repoRoot, repaired.proposal, verifying('model'))
    if (!repairedVerdict.ok) {
      // No second retry: the session already iterated inside its budget, and the
      // resume path is the NEXT run's — not this one's.
      return {
        status: 'verify-failed',
        reason: repairedVerdict.reason,
        proposal: repaired.proposal,
        ...(sessionRunId ? { sessionRunId } : {}),
      }
    }
    const repairedRecipe: Recipe = {
      ...(repaired.proposal.install ? { install: repaired.proposal.install } : {}),
      build: repaired.proposal.build,
      ...(repaired.proposal.entry ? { entry: repaired.proposal.entry } : {}),
      ...(repaired.proposal.env ? { env: repaired.proposal.env } : {}),
      ...(repaired.proposal.api ? { api: repaired.proposal.api } : {}),
      ...(repaired.proposal.web ? { web: repaired.proposal.web } : {}),
      ...(repaired.proposal.ownHosts ? { ownHosts: repaired.proposal.ownHosts } : {}),
    }
    return {
      status: 'discovered',
      recipe: repairedRecipe,
      ...writeRecipeFile(repoRoot, repairedRecipe),
      source: 'llm',
      todos: repairedVerdict.warnings ?? [],
      ...(sessionRunId ? { sessionRunId } : {}),
    }
  }

  // The LLM proposal is cached on the discovery-input fingerprint — unchanged
  // inputs reuse the prior proposal, but verification always re-runs.
  let proposal: RecipeProposal | null = null
  const cached = await getCacheEntry(repoRoot, RECIPE_CACHE_NAME, recipeCacheKey(inputsFingerprint))
  if (cached) {
    const parsed = RecipeProposalSchema.safeParse(cached)
    if (parsed.success) proposal = parsed.data
  }
  if (!proposal) {
    options.onPhase?.({ kind: 'proposing', ...(deterministicStage ? { after: deterministicStage } : {}) })
    const attempt = await proposeRecipeWithReask(inputs, runner, deterministicEvidence)
    // An unreachable model must not ERASE what the engine already learned: when a
    // deterministic proposal was tried and rejected, its diagnostic (the actionable
    // one — it names the repo's own commands and, for a datastore repo, what to do
    // about it) leads, and the transport failure is the footnote it is.
    if ('error' in attempt) {
      return {
        status: 'verify-failed',
        reason: deterministicFailure
          ? `${deterministicFailure}\n\n(the model fallback could not be reached: ${attempt.error})`
          : attempt.error,
      }
    }
    proposal = attempt.proposal
    await setCacheEntry(repoRoot, RECIPE_CACHE_NAME, recipeCacheKey(inputsFingerprint), proposal)
  }

  let verdict = await verifyProposal(repoRoot, proposal, verifying('model'))
  if (!verdict.ok) {
    // ONE evidence retry. The engine hands back its OWN verification report,
    // verbatim, and re-verifies whatever comes back — in full, from install
    // onwards. Nothing here reads the report: install, build, entry-file, and
    // entrypoint failures are one path, so a new failure kind needs no new code.
    options.onPhase?.({ kind: 'proposing', after: verdict.stage })
    const retried = await proposeRecipeWithReask(inputs, runner, {
      proposal: JSON.stringify(proposal, null, 2),
      failure: verdict.reason,
    })
    // A retry that yields no valid proposal (no transport, a thrown call, output
    // still invalid after its re-ask) leaves the original diagnostic untouched —
    // exactly the failure the caller would have surfaced without a retry.
    if (!('error' in retried)) {
      proposal = retried.proposal
      verdict = await verifyProposal(repoRoot, proposal, verifying('model'))
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
    // written through as-is; the richer fields (credentials, seed) are never
    // model-proposed.
    ...(proposal.api ? { api: proposal.api } : {}),
    ...(proposal.web ? { web: proposal.web } : {}),
    ...(proposal.ownHosts ? { ownHosts: proposal.ownHosts } : {}),
  }
  return {
    status: 'discovered',
    recipe,
    ...writeRecipeFile(repoRoot, recipe),
    source: 'llm',
    todos: verdict.ok ? (verdict.warnings ?? []) : [],
  }
}

/** Write the verified recipe and report where it landed + the fingerprint it now
 *  carries — the one place a recipe reaches disk, shared by both proposers. */
function writeRecipeFile(repoRoot: string, recipe: Recipe): { fingerprint: string; wrotePath: string } {
  const target = recipePath(repoRoot)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(recipe, null, 2) + '\n')
  return { fingerprint: computeRecipeFingerprint(repoRoot), wrotePath: path.relative(repoRoot, target) }
}

/**
 * Write the generated datastore compose file where the proposal's
 * `services.up` expects it, and hand back the undo. It has to be the FINAL path —
 * the command names it — so the write-then-restore pattern is what keeps a refused
 * run from leaving anything behind: `revert()` deletes the file, or puts back the
 * exact bytes that were there (an orphan from an earlier refused run).
 */
function writeComposeFile(repoRoot: string, plan: ComposePlan): { rel: string; revert: () => void } {
  const target = path.join(repoRoot, plan.file)
  const before = fs.existsSync(target) ? fs.readFileSync(target) : null
  fs.writeFileSync(target, plan.content)
  return {
    rel: plan.file,
    revert: () => {
      try {
        if (before === null) fs.rmSync(target, { force: true })
        else fs.writeFileSync(target, before)
      } catch {
        /* a tree we cannot clean up is not a reason to lose the verdict */
      }
    },
  }
}

/** One proposal's deterministic verdict: it verified, or the engine's report on why
 *  not, tagged with the stage that produced it (the reason already names it in prose;
 *  `stage` is the same fact a caller can branch on without reading the text). */
export type ProposalVerdict =
  /** `warnings` (present only when non-empty): true-but-fragile facts a green
   *  verdict must not swallow — e.g. the boot leaned on a localhost datastore
   *  the recipe never brings up. Surfaced as todos and in the session's
   *  verify_recipe result. */
  | { ok: true; warnings?: string[] }
  | { ok: false; reason: string; stage: RecipeVerifyStage }

/**
 * What verification READS — the fields both proposal shapes share. Structural, so
 * the model's `RecipeProposal` and the deterministic proposer's full `Recipe` (with
 * its `services` / `credentials`, which no boot check needs) verify through the
 * exact same path.
 */
export type VerifiableProposal = {
  install?: string
  build: string
  entry?: readonly string[]
  env?: Record<string, string>
  api?: {
    /** The single-server shape; a multi-service proposal carries `servers` instead. */
    serve?: readonly string[]
    healthPath?: string
    env?: Record<string, string>
    cwd?: 'sandbox' | 'repo'
    /** The multi-server shape — EVERY entry must boot for the proposal to verify. */
    servers?: Record<
      string,
      { serve: readonly string[]; healthPath?: string; env?: Record<string, string>; cwd?: 'sandbox' | 'repo' }
    >
    /** The datastore bring-up/tear-down (compose-derived or model-proposed);
     *  verification runs whatever the proposal carries. `reset` is not run here —
     *  it is the runner's post-mutator restore, and a wipe has no place in a
     *  verification pass. */
    services?: { up: string; down?: string; reset?: string }
  }
  /** The browser surface — booted and health-polled like any server. */
  web?: {
    build?: string
    serve: readonly string[]
    cwd?: 'sandbox' | 'repo'
    healthPath?: string
    readyTimeoutMs?: number
    env?: Record<string, string>
    app?: string
  }
}

/** One server of a proposal, either shape collapsed (the verification's unit of work). */
interface VerifiableServer {
  name: string
  serve: readonly string[]
  healthPath?: string
  env?: Record<string, string>
  cwd?: 'sandbox' | 'repo'
}

/** Collapse a proposal's api block into the servers verification must boot. */
function proposalServers(api: NonNullable<VerifiableProposal['api']>): VerifiableServer[] {
  if (api.serve) {
    return [
      {
        name: 'default',
        serve: api.serve,
        ...(api.healthPath ? { healthPath: api.healthPath } : {}),
        ...(api.env ? { env: api.env } : {}),
        ...(api.cwd ? { cwd: api.cwd } : {}),
      },
    ]
  }
  return Object.entries(api.servers ?? {}).map(([name, server]) => ({ name, ...server }))
}

/** The wildcard probe's answer: `stub` when the booted server answered the health
 *  path and two unservable paths byte-identically. Inconclusive probes (a fetch
 *  error, a timeout) are NOT stubs — the boot already proved health answers. */
type WildcardVerdict = { stub: boolean }

/** How much of a response body the wildcard probe compares. A stub's body is a
 *  constant; real per-path content diverges long before this. */
const WILDCARD_BODY_CAP = 2_048
const WILDCARD_FETCH_TIMEOUT_MS = 5_000

async function wildcardResponse(baseUrl: string, path_: string): Promise<string | null> {
  try {
    const res = await fetch(new URL(path_, baseUrl), {
      redirect: 'manual',
      signal: AbortSignal.timeout(WILDCARD_FETCH_TIMEOUT_MS),
    })
    const body = (await res.text()).slice(0, WILDCARD_BODY_CAP)
    return `${res.status}\n${body}`
  } catch {
    return null
  }
}

/**
 * The anti-stub check: GET the health path and two paths no application could
 * declare. Identical status+body on all three means the server answers every
 * path the same — a hand-rolled 200-everything stub, not the app under test.
 * Ran only here in DISCOVERY; the runner's preflight never re-probes a recipe a
 * human has already accepted.
 */
async function probeWildcard(baseUrl: string, healthPath: string): Promise<WildcardVerdict> {
  const health = await wildcardResponse(baseUrl, healthPath)
  if (health === null) return { stub: false }
  const nonce = createHash('sha256').update(`${baseUrl}${Date.now()}`).digest('hex').slice(0, 12)
  const [a, b] = await Promise.all([
    wildcardResponse(baseUrl, `/tc-guard-verify-${nonce}`),
    wildcardResponse(baseUrl, `/tc-guard-verify-${nonce}/deeper/still`),
  ])
  return { stub: a !== null && b !== null && a === health && b === health }
}

/** What verification may consult when composing a failure diagnostic, and where it
 *  reports the stage it is in. Lazy: a proposal that verifies never resolves any of it. */
export type VerifyContext = {
  database?: () => Promise<DatabaseDependencyHint | null>
  /**
   * Set once a GENERATED datastore was written and verified in this
   * discovery and still failed. The guided message then drops "add a compose file"
   * as advice — guard already did, and it did not help.
   */
  composeGenerated?: boolean
  /** Fires as each stage STARTS. Every one of them can run for minutes. */
  onPhase?: (phase: { stage: RecipeVerifyStage; server?: string }) => void
  /**
   * The workspace app inventory (the same one the model's briefing shows).
   * When present, the static stage refuses a proposal that declares no `api`
   * block while the inventory lists apps with HTTP route prefixes — the cal.com
   * failure mode: an entry-only CLI recipe for a repo whose documented surface
   * is its HTTP services.
   */
  apps?: readonly RecipeAppInventoryEntry[]
}

/**
 * Verify ONE proposal end to end, in the order the runner will use it: install,
 * build, the post-build entry-file existence check, the entrypoint probe, then —
 * for an api proposal — `api.services.up`, the boot, and `api.services.down`.
 * Every rejection returns the engine's report — the text the caller surfaces AND
 * the evidence the retry quotes back, so both read the same story, and each step
 * names ITSELF (`install …`, `build …`, `services …`, `api server …`) so a reader
 * never has to guess which one died.
 */
export async function verifyProposal(
  repoRoot: string,
  proposal: VerifiableProposal,
  context: VerifyContext = {},
): Promise<ProposalVerdict> {
  // Stage zero: the free refusal rules, so a proposal the engine would never
  // accept is rejected before minutes of install/build run — and so EVERY path a
  // proposal can arrive by (deterministic, session outcome, one-shot, cache) is
  // held to the same rules, not just the session's `check_recipe` tool.
  const complaints = staticProposalComplaints(proposal, context.apps, repoRoot)
  if (complaints.length > 0) {
    return {
      ok: false,
      stage: 'static',
      reason: `refused before anything ran:\n- ${complaints.join('\n- ')}`,
    }
  }

  // The optional install step runs BEFORE the verification build, exactly as the
  // runner will run it — a proposal whose install fails is never written.
  if (proposal.install) {
    context.onPhase?.({ stage: 'install' })
    const install = await runInstall(repoRoot, proposal.install, proposal.env, INSTALL_TIMEOUT_MS)
    if (!install.ok) {
      const tail = install.output.trimEnd().split('\n').slice(-5).join(' / ')
      return {
        ok: false,
        stage: 'install',
        reason: `install \`${proposal.install}\` failed${install.timedOut ? ' (timed out)' : ''}: ${tail}`,
      }
    }
  }

  context.onPhase?.({ stage: 'build' })
  const build = await runBuild(repoRoot, proposal.build, proposal.env, BUILD_TIMEOUT_MS)
  if (!build.ok) {
    const tail = build.output.trimEnd().split('\n').slice(-5).join(' / ')
    return {
      ok: false,
      stage: 'build',
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
    if (missing) {
      return { ok: false, stage: 'entry probe', reason: `after \`${proposal.build}\`, ${formatMissingEntryScript(missing)}` }
    }

    context.onPhase?.({ stage: 'entry probe' })
    const probe = await probeEntry(repoRoot, proposal.entry)
    if (!probe.ok) return { ok: false, stage: 'entry probe', reason: probe.reason }
  }

  // The web half's boot, run while any declared services are still up (a
  // fullstack web serve needs the same datastore the api serve does). The same
  // preflight the api servers go through — the web surface is an HTTP server
  // whose health answer happens to be a page — with the web defaults applied
  // exactly as `resolveWebSurface` applies them for the runner.
  const verifyWebBoot = async (): Promise<ProposalVerdict | null> => {
    const web = proposal.web
    if (!web) return null
    if (web.build) {
      context.onPhase?.({ stage: 'web boot' })
      const webBuild = await runBuild(repoRoot, web.build, proposal.env, BUILD_TIMEOUT_MS)
      if (!webBuild.ok) {
        const tail = webBuild.output.trimEnd().split('\n').slice(-5).join(' / ')
        return {
          ok: false,
          stage: 'web boot',
          reason: `web build \`${web.build}\` failed${webBuild.timedOut ? ' (timed out)' : ''}: ${tail}`,
        }
      }
    }
    context.onPhase?.({ stage: 'web boot' })
    const healthPath = web.healthPath ?? DEFAULT_WEB_HEALTH_PATH
    const boot = await preflightApiServer({
      resolvedServe: resolveEntry(repoRoot, web.serve),
      displayServe: web.serve,
      ...(web.cwd === 'repo' ? { cwd: repoRoot } : {}),
      recipeEnv: { ...(proposal.env ?? {}), ...(web.env ?? {}) },
      healthPath,
      readyTimeoutMs: web.readyTimeoutMs ?? DEFAULT_WEB_READY_TIMEOUT_MS,
      label: 'web',
    })
    if (boot.ok) return null
    return {
      ok: false,
      stage: 'web boot',
      reason: `web surface \`${web.serve.join(' ')}\` did not answer ${healthPath}: ${boot.stderr}`,
    }
  }

  // The api half — the server's analog of the entry probe: the proposal's own
  // datastore bring-up (exactly as `run.ts` runs it: the repo's command, through
  // `runBuild`, in the repo root, with the recipe env), then boot the proposed
  // `serve` argv in a throwaway sandbox and wait for its health path, through the
  // SAME `preflightApiServer` the runner gates every api run with, so a proposal
  // that verifies here is one the runner can actually start. Its failure text
  // already carries the server's captured startup output.
  if (proposal.api) {
    const api = proposal.api
    let servicesUp = false
    try {
      if (api.services) {
        context.onPhase?.({ stage: 'services' })
        const up = await runBuild(repoRoot, api.services.up, proposal.env, SERVICES_TIMEOUT_MS)
        // A services failure is NOT a boot failure and must not read like one: a
        // missing docker daemon, an occupied port, an unpullable image all die
        // here, and the command's own output is the whole diagnostic.
        if (!up.ok) {
          const tail = up.output.trimEnd().split('\n').slice(-5).join(' / ')
          return {
            ok: false,
            stage: 'services',
            reason: `services \`${api.services.up}\` failed${up.timedOut ? ' (timed out)' : ''}: ${tail}`,
          }
        }
        servicesUp = true
      }

      // Every DECLARED server must start: a two-service proposal that only half
      // boots is a recipe whose second service's endpoints are untestable, which is
      // exactly the failure `api.servers` exists to prevent. `services` is brought
      // up once around the whole loop — it is the shared world, not per-server.
      const servers = proposalServers(api)
      for (const server of servers) {
        context.onPhase?.({ stage: 'server boot', ...(servers.length > 1 ? { server: server.name } : {}) })
        // The wildcard probe runs while the server is still up (`onReady`). A
        // trivial stub answers every path with the health response byte for byte;
        // a real app — even an SPA with a catch-all — serves per-path content.
        let wildcard: WildcardVerdict | null = null
        const healthPath = server.healthPath ?? DEFAULT_API_HEALTH_PATH
        const boot = await preflightApiServer({
          resolvedServe: resolveEntry(repoRoot, server.serve),
          displayServe: server.serve,
          ...(server.cwd === 'repo' ? { cwd: repoRoot } : {}),
          recipeEnv: { ...(proposal.env ?? {}), ...(api.env ?? {}), ...(server.env ?? {}) },
          healthPath,
          readyTimeoutMs: DEFAULT_API_READY_TIMEOUT_MS,
          ...(servers.length > 1 ? { label: server.name } : {}),
          onReady: async (baseUrl) => {
            wildcard = await probeWildcard(baseUrl, healthPath)
          },
        })
        if (boot.ok && wildcard !== null && (wildcard as WildcardVerdict).stub) {
          return {
            ok: false,
            stage: 'server boot',
            reason:
              `api server \`${server.serve.join(' ')}\` answered ${healthPath} and two paths it cannot possibly serve ` +
              `with the identical response — a server that answers every path the same is not the application this ` +
              `repository ships. Propose the repo's OWN server (its start script or built entrypoint), not a stand-in.`,
          }
        }
        if (boot.ok) continue
        const bootReason = `api server \`${server.serve.join(' ')}\` did not start: ${boot.stderr}`
        // The datastore story, when there is one to tell: the analyzer saw a
        // database dependency and the proposal has no `services` to bring one up,
        // so the boot almost certainly died on a connection nobody could make.
        // Leads with WHY and what to do; the boot excerpt follows it.
        if (!api.services) {
          const database = await context.database?.().catch(() => null)
          if (database) {
            return {
              ok: false,
              stage: 'server boot',
              reason: `${databaseGuidance(database, context.composeGenerated === true)}\n\n${bootReason}`,
            }
          }
        }
        return { ok: false, stage: 'server boot', reason: bootReason }
      }
      // The web surface boots inside the same services scope: a fullstack web
      // serve dies without the datastore the api half brought up.
      const webFailure = await verifyWebBoot()
      if (webFailure) return webFailure
    } finally {
      // Teardown is best-effort and NEVER a verdict — a datastore that will not
      // stop is a warning, not a reason to reject a recipe that booted.
      if (servicesUp && api.services?.down) {
        const down = await runBuild(repoRoot, api.services.down, proposal.env, SERVICES_TIMEOUT_MS)
        if (!down.ok) {
          // eslint-disable-next-line no-console -- verification's one advisory line.
          console.warn(
            `[guard recipe] \`${api.services.down}\` failed after verification — the services it brought up may still be running.`,
          )
        }
      }
    }
  }
  // A web-only proposal (no api block) still proves its boot.
  if (!proposal.api) {
    const webFailure = await verifyWebBoot()
    if (webFailure) return webFailure
  }
  const warnings = proposalWarnings(proposal)
  return warnings.length > 0 ? { ok: true, warnings } : { ok: true }
}

/** Datastore URL env values pointing at THIS machine — a boot that succeeded on
 *  them succeeded because something local happened to be running. */
const LOCAL_DATASTORE_URL = /^(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^@/]*@?(?:localhost|127\.0\.0\.1)\b/i

/**
 * True-but-fragile facts about a proposal that VERIFIED — the boot leaned on a
 * localhost datastore it never brings up (`api.services` absent), so the green
 * is this machine's, not the recipe's (cal.diy 2026-08-20: the boot rode the
 * developer's already-running :5450 postgres).
 */
function proposalWarnings(proposal: VerifiableProposal): string[] {
  const api = proposal.api
  if (!api) return []
  const layers: Record<string, string>[] = [
    proposal.env ?? {},
    api.env ?? {},
    ...Object.values(api.servers ?? {}).map((s) => s.env ?? {}),
  ]
  const urls = new Set<string>()
  const sqlUrls = new Set<string>()
  for (const layer of layers) {
    for (const value of Object.values(layer)) {
      const trimmed = value.trim()
      if (LOCAL_DATASTORE_URL.test(trimmed)) urls.add(trimmed)
      if (SQL_DATASTORE_URL.test(trimmed)) sqlUrls.add(trimmed)
    }
  }
  if (!api.services) {
    if (urls.size === 0) return []
    return [
      `the recipe points at localhost datastore(s) it never brings up (${[...urls].slice(0, 3).join(', ')}) and ` +
      `declares no \`api.services\` — the boot passed because something on THIS machine happened to be running. ` +
      `On a clean host it will die at boot. Declare the bring-up under \`api.services.up\`/\`down\` ` +
      `(a compose file the repo ships, or guard's generated one).`,
    ]
  }
  // Services declared, but no schema step among them: the sibling fragility
  // (cal.diy 2026-08-21). The compose brings the database container up, nothing
  // ever migrates it, and the boot verified against whatever schema the volume
  // ALREADY carried — a clean host gets an empty database and the health probe
  // can still answer 200.
  const commands = [proposal.install, proposal.build, api.services.up, api.services.down]
    .filter((c): c is string => typeof c === 'string')
    .join('\n')
  if (sqlUrls.size > 0 && !MIGRATE_STEP.test(commands)) {
    return [
      `\`api.services\` brings the datastore up but NO command anywhere in the recipe (install, build, ` +
      `services.up) runs a schema/migration step — the boot verified against whatever schema the datastore's ` +
      `volume already carried, and a clean host gets an EMPTY database behind a green health probe. Run the ` +
      `repo's migrate/deploy step inside \`api.services.up\` after the bring-up.`,
    ]
  }
  return []
}

/** SQL datastore URLs — the stores whose empty-schema state a health probe hides. */
const SQL_DATASTORE_URL = /^(?:postgres(?:ql)?|mysql):\/\//i

/** A schema/migration step by any of the common spellings (`prisma migrate`,
 *  `db-deploy`, `db:push`, `knex migrate`, plain `migrations` scripts…). */
const MIGRATE_STEP = /migrat|db-deploy|db:deploy|db[:-]push|db\s+push|schema:sync/i

/**
 * The guided failure text for a server that would not boot on a repo the analyzer
 * says needs a datastore, with no `api.services` to bring one up. Three real
 * remedies, in the order a user can act on them.
 */
function databaseGuidance(database: DatabaseDependencyHint, composeGenerated: boolean): string {
  const detected = database.driver === database.type ? database.driver : `${database.driver}/${database.type}`
  return [
    `the app depends on a database (${detected} detected) and no datastore was reachable at boot — and this repository declares no \`api.services\` for guard to bring one up. Either:`,
    `  • start your database (and make sure the app's connection variables point at it), or`,
    // When guard already GENERATED a compose file and the chain still failed, "add a
    // compose file" is advice guard just took — say what happened instead, so the
    // next thing the user tries is a new one.
    composeGenerated
      ? `  • fix what stopped the ${GUARD_COMPOSE_FILE} guard generated from this app's own connection URL (it was written, verified, and removed again — the failure above is why), or`
      : `  • add a docker-compose file with the datastore — guard proposes \`api.services\` from it, or`,
    `  • hand-write \`api.services\` + the connection env (e.g. \`api.env.DATABASE_URL\`) in .truecourse/scenarios/recipe.json.`,
  ].join('\n')
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

// ---------------------------------------------------------------------------
// The static proposal check (`check_recipe`, plan 03 step 9) — the cheap half
// of the validator-as-tool pattern: everything that can be refused WITHOUT
// executing anything. The schema itself is enforced by the session shell (the
// tool's inputSchema IS `RecipeProposalSchema`); this adds the deterministic
// proposer's own refusal rules so a session hears them in one turn instead of
// discovering them minutes into a `verify_recipe`.
// ---------------------------------------------------------------------------

/**
 * The static complaints about a schema-valid proposal, empty when it is clean.
 * No execution — `verifyProposal` is the expensive check, and this exists so a
 * proposal that could never verify is refused for one turn's cost.
 */
/** Eval flags per interpreter — an argv driving one of these runs INLINE code,
 *  not anything the repository ships. `deno` spells it as the `eval` subcommand. */
const INLINE_EVAL_FLAGS: Record<string, readonly string[]> = {
  node: ['-e', '--eval', '-p', '--print'],
  nodejs: ['-e', '--eval', '-p', '--print'],
  bun: ['-e', '--eval', '-p', '--print'],
  deno: ['eval'],
  python: ['-c'],
  python3: ['-c'],
  ruby: ['-e'],
  perl: ['-e', '-E'],
  sh: ['-c'],
  bash: ['-c'],
  zsh: ['-c'],
  dash: ['-c'],
}

/** The `label runs inline code` complaint for one argv, or null when it does not. */
function inlineEvalComplaint(label: string, argv: readonly string[]): string | null {
  const interpreter = path.basename(argv[0] ?? '')
  const flags = INLINE_EVAL_FLAGS[interpreter]
  if (!flags) return null
  const flag = argv.slice(1).find((el) => flags.includes(el))
  if (!flag) return null
  return (
    `${label} runs inline code (\`${interpreter} ${flag} …\`) instead of something this repository ships — ` +
    `the thing under test must be the repo's own file or script, so a hand-written stand-in proves nothing. ` +
    `Point the argv at a file in the repository.`
  )
}

/** An install/build that is nothing but one interpreter-eval one-liner builds
 *  nothing. `true` is the honest way to declare "no build". */
const INLINE_EVAL_SHELL = /^\s*(?:node|nodejs|bun|python3?|ruby|perl)\s+(?:-e|--eval|-p|--print|-c|-E)\b|^\s*deno\s+eval\b/

/** Datastore bring-up spelled as a build step. It works once and then leaks: the
 *  runner tears down `api.services.down`, never whatever a build left running
 *  (documenso 2026-08-20: a compose db container survived verification). */
const COMPOSE_UP_SHELL = /\bdocker(?:\s+|-)compose\b[^|;&]*\bup\b/

/** Command fragments that mutate the HOST outside the repository. An
 *  install/build runs as a real shell in the working tree, so these execute for
 *  real — and a recipe commits every future run to them. */
const HOST_MUTATION_PATTERNS: { pattern: RegExp; what: string }[] = [
  { pattern: /\bsudo\b/, what: '`sudo`' },
  { pattern: /\bcorepack\s+enable\b/, what: '`corepack enable` (writes yarn/pnpm shims beside the node binary — invoke the pinned manager WITHOUT enabling shims: `corepack yarn install …`)' },
  { pattern: /\b(?:npm|pnpm)\s+(?:i|install|add)\b[^|;&]*(?:\s-g\b|\s--global\b)/, what: 'a global package install' },
  { pattern: /\byarn\s+global\b/, what: '`yarn global`' },
  { pattern: /\bbrew\s+install\b/, what: '`brew install`' },
  { pattern: /\bnpm\s+config\s+set\b/, what: '`npm config set`' },
  { pattern: /\bgit\s+config\s+--global\b/, what: '`git config --global`' },
  { pattern: /\b(?:launchctl|systemctl)\b/, what: 'a service-manager command' },
  // `docker compose down` is project-scoped and fine; `docker rm -f <name>`
  // reaches across EVERY project on the machine. The 2026-08-20 documenso
  // session put `docker rm -f database` in services.up to free a container
  // name its compose wanted — and removed the developer's running cal.diy
  // database. A name collision is the USER's to resolve, never the recipe's.
  { pattern: /\bdocker\s+(?:container\s+)?(?:rm|kill|stop)\b/, what: '`docker rm/kill/stop` (it targets containers by GLOBAL name — other projects\' containers included; resolve a name collision by asking, never by removing)' },
  { pattern: /\bdocker\s+volume\s+(?:rm|prune)\b/, what: '`docker volume rm/prune`' },
  { pattern: /\bdocker\s+system\s+prune\b/, what: '`docker system prune`' },
]

/** Each `docker compose` / `docker-compose` invocation in a shell command, up to
 *  the next shell operator — enough of the argv to find its `-p`/`-f` flags. The
 *  lookbehind keeps `my-docker compose` wrappers from matching: the command must
 *  BE docker. */
const DOCKER_COMPOSE_CALL = /(?<![\w-])docker(?:\s+|-)compose\b([^|;&]*)/g

/**
 * The compose NAMESPACE rule — the boundary the `docker rm/kill/stop` refusal
 * left open (cal.diy 2026-08-21): `docker compose up/stop` with no explicit
 * project attaches to the repository's DEFAULT compose project — the
 * developer's own live stack — and compose "resolves" a port or config change
 * by RECREATING the running container (a verified recipe re-ported the
 * developer's running redis to a new port and left it stopped, through this
 * exact channel). A compose invocation in a recipe channel must therefore be
 * namespaced: `-p <project>`, or an `-f` file that pins a top-level `name:`
 * (the repo's dedicated test composes do; its dev compose does not).
 *
 * Returns one complaint per un-namespaced invocation. `repoRoot` grounds the
 * `-f` file check; without it (older callers, unit contexts) a file reference
 * cannot be verified and is treated as unpinned — conservative on purpose.
 */
function composeNamespaceComplaints(label: string, command: string, repoRoot?: string): string[] {
  const complaints: string[] = []
  for (const match of command.matchAll(DOCKER_COMPOSE_CALL)) {
    const tokens = (match[1] ?? '').trim().split(/\s+/).filter(Boolean)
    let hasProject = false
    const files: string[] = []
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!
      if (t === '-p' || t === '--project-name') { hasProject = true; i++ }
      else if (t.startsWith('--project-name=')) hasProject = true
      else if (t === '-f' || t === '--file') { const v = tokens[i + 1]; if (v) files.push(v); i++ }
      else if (t.startsWith('--file=')) files.push(t.slice('--file='.length))
    }
    if (hasProject) continue
    const pinsName = (file: string): boolean => {
      if (file === '-') return false // stdin — nothing to inspect; demand `-p`
      if (!repoRoot) return false
      try {
        return /^name:\s*\S/m.test(fs.readFileSync(path.resolve(repoRoot, file), 'utf-8'))
      } catch {
        return false
      }
    }
    if (files.length > 0 && files.some(pinsName)) continue
    const why =
      files.length === 0
        ? 'no `-f` file and no `-p` project'
        : `the file(s) it names (${files.join(', ')}) pin no top-level \`name:\``
    complaints.push(
      `${label} runs \`docker compose\` without an explicit project namespace (${why}) — it attaches to the ` +
      `repository's DEFAULT compose project, i.e. the developer's own stack, and compose resolves a port or ` +
      `config change by RECREATING a running container (this is how a verified recipe once re-ported and stopped ` +
      `the developer's live redis). Namespace it: pass \`-p <dedicated-project>\`, or point \`-f\` at a compose ` +
      `file that declares a top-level \`name:\` (a dedicated test compose, never the dev compose).`,
    )
  }
  return complaints
}

export function staticProposalComplaints(
  proposal: VerifiableProposal,
  apps?: readonly RecipeAppInventoryEntry[],
  /** Grounds the compose-namespace rule's `-f` file check; absent ⇒ a file
   *  reference cannot be verified and counts as unpinned (conservative). */
  repoRoot?: string,
): string[] {
  const complaints: string[] = []
  const argvs: { label: string; argv: readonly string[] }[] = []
  if (proposal.entry) argvs.push({ label: 'entry', argv: proposal.entry })
  if (proposal.api?.serve) argvs.push({ label: 'api.serve', argv: proposal.api.serve })
  for (const [name, server] of Object.entries(proposal.api?.servers ?? {})) {
    argvs.push({ label: `api.servers.${name}.serve`, argv: server.serve })
  }
  for (const { label, argv } of argvs) {
    for (const element of argv) {
      const operator = SHELL_OPERATORS.find((op) => element.includes(op))
      if (operator) {
        complaints.push(
          `${label} carries the shell operator \`${operator}\` in ${JSON.stringify(element)} — an argv is spawned directly, never through a shell, so a compound command cannot work there. Put shell composition in \`build\`/\`install\` (which ARE shell commands), or split the argv.`,
        )
      }
    }
    const inline = inlineEvalComplaint(label, argv)
    if (inline) complaints.push(inline)
  }
  // Only the SERVE argvs are held to the watcher rule: a dev/watch process never
  // exits ready and never serves a stable build, so it is not a server under test.
  for (const { label, argv } of argvs.filter((a) => a.label !== 'entry')) {
    const joined = argv.join(' ').toLowerCase()
    const marker = DEV_SCRIPT_MARKERS.find((m) => joined.includes(m))
    if (marker) {
      complaints.push(
        `${label} looks like a dev/watch command (\`${marker}\`) — a file watcher is not a server under test. Propose the production start of the BUILT server.`,
      )
    }
  }
  // An eval one-liner as the WHOLE install/build is a no-op wearing a build's
  // clothes. Only the pure form is refused — a compound command that happens to
  // start with `node -e` is doing something more, and `true` stays the sanctioned
  // "this repo needs no build".
  for (const [label, command] of [['install', proposal.install], ['build', proposal.build]] as const) {
    if (!command) continue
    if (INLINE_EVAL_SHELL.test(command) && !SHELL_OPERATORS.some((op) => command.includes(op))) {
      complaints.push(
        `${label} is an inline eval one-liner (\`${command}\`) — it ${label === 'build' ? 'builds' : 'installs'} nothing. ` +
        `Use the repo's own ${label} script, or \`true\` when the repository genuinely needs no ${label} step.`,
      )
    }
    // Datastore bring-up belongs in `api.services.up` (with a `down`), never in a
    // build: the runner tears down services, but whatever a build starts leaks.
    if (COMPOSE_UP_SHELL.test(command)) {
      complaints.push(
        `${label} brings up docker compose services — that is world SETUP, not a ${label}. Move the bring-up to ` +
        `\`api.services.up\` (and its stop to \`api.services.down\`) so the runner owns the lifecycle; a compose ` +
        `left running by a ${label} is never torn down.`,
      )
    }
    // Host mutations: an install/build runs as a real shell in the working tree.
    for (const { pattern, what } of HOST_MUTATION_PATTERNS) {
      if (pattern.test(command)) {
        complaints.push(
          `${label} runs ${what} — it mutates the machine OUTSIDE this repository, and the recipe would commit ` +
          `every future run to that. An install/build may only touch the repo's own working tree.`,
        )
      }
    }
    complaints.push(...composeNamespaceComplaints(label, command, repoRoot))
  }
  // `services.up`/`down` ARE the compose home, but the host-mutation rules hold
  // there too — bringing up the repo's own datastore never needs to escalate or
  // write outside the repo.
  const services = proposal.api?.services
  for (const [label, command] of [['api.services.up', services?.up], ['api.services.down', services?.down]] as const) {
    if (!command) continue
    complaints.push(...composeNamespaceComplaints(label, command, repoRoot))
    for (const { pattern, what } of HOST_MUTATION_PATTERNS) {
      if (pattern.test(command)) {
        complaints.push(
          `${label} runs ${what} — it mutates the machine OUTSIDE this repository. Services bring-up may only ` +
          `run what the repo ships (its compose file, its scripts).`,
        )
      }
    }
  }
  // `sudo` has no place in any argv either — a server or CLI under test never
  // escalates the host.
  for (const { label, argv } of argvs) {
    if (argv.includes('sudo')) {
      complaints.push(`${label} invokes \`sudo\` — nothing under test may escalate on the host.`)
    }
  }
  // The inventory rule: a workspace that ships HTTP services and a proposal that
  // declares no api block is the cal.com failure — every documented endpoint
  // lands untestable while the recipe reads green. Partial coverage is NOT
  // refused (a monorepo routinely serves one app and ships others it never
  // runs); only the claim that there is no server at all.
  if (!proposal.api && apps) {
    const routed = apps.filter((a) => a.prefixes.length > 0)
    if (routed.length > 0) {
      const listed = routed
        .slice(0, 4)
        .map((a) => `${a.dir} (serves ${a.prefixes.slice(0, 3).join(', ')})`)
        .join('; ')
      complaints.push(
        `the workspace ships ${routed.length} HTTP service(s) this proposal does not declare: ${listed}` +
        `${routed.length > 4 ? '; …' : ''} — a recipe with no \`api\` block leaves every documented endpoint ` +
        `untestable. Declare the server(s) under \`api.serve\` or \`api.servers\` (an \`entry\`-only recipe is ` +
        `only right for a repository whose product is the CLI).`,
      )
    }
  }
  // The browser-app rule, the web analog of the inventory rule above: a repo
  // that ships a browser app and a proposal with no `web` block leaves every
  // screen-driven claim untestable — and until this rule existed, the web block
  // was the ONE recipe piece setup never authored (documenso 2026-08-30: a
  // from-scratch setup produced an api-only recipe and silently dropped the web
  // surface). Held here so every proposal path — deterministic, session,
  // one-shot, cache — is forced through it, not just prompted.
  if (!proposal.web) {
    const browserApps = browserAppEvidence(apps, repoRoot)
    if (browserApps.length > 0) {
      complaints.push(
        `this repository ships a browser app (${browserApps.join('; ')}) and the proposal declares no \`web\` ` +
        `block — every screen-driven claim lands untestable. Declare \`web\`: a \`serve\` argv (for a fullstack ` +
        `app this is often the same server the \`api\` block boots), a \`healthPath\` naming a page that actually ` +
        `RENDERS (a login or sign-in page beats \`/\`, which often redirects), any env the app needs to address ` +
        `itself (\`\${PORT}\` is substituted at boot), and — in a monorepo — \`app\` naming the served workspace ` +
        `app's directory.`,
      )
    }
  }
  // The reset rule: a `services.up` that manages a datastore through docker
  // compose without a `reset` leaves the runner unable to restore the world
  // after a `world: mutates` tail — and the engine bars world-mutating tests
  // outright without one, so the omission silently blocks every credential/
  // deletion/config flow. `down -v` with the SAME compose file is the wipe.
  if (services?.up && /(?<![\w-])docker(?:\s+|-)compose\b/.test(services.up) && !services.reset) {
    const composeFile = /-f\s+(\S+)/.exec(services.up)?.[1]
    const suggested = composeFile ? `docker compose -f ${composeFile} down -v` : 'docker compose down -v'
    complaints.push(
      `\`api.services.up\` manages docker compose services but declares no \`reset\` — without one the runner ` +
      `cannot restore the world after a \`world: mutates\` test, so every world-mutating scenario (credential ` +
      `changes, account deletion, global config) is barred. Declare \`api.services.reset\` as the full wipe, ` +
      `volumes included: \`${suggested}\`.`,
    )
  }
  return complaints
}

/**
 * The deterministic "a browser app exists" signal the web rule keys on: a
 * `next`/`remix` workspace app in the route-manifest inventory, or — for a
 * single-package repo the inventory cannot see — a browser framework in the
 * root package.json's dependencies. Returns human-readable evidence strings,
 * empty when nothing browser-shaped is found.
 */
export function browserAppEvidence(
  apps: readonly RecipeAppInventoryEntry[] | undefined,
  repoRoot?: string,
): string[] {
  const evidence: string[] = []
  for (const app of apps ?? []) {
    if (app.framework === 'next' || app.framework === 'remix') {
      evidence.push(`${app.dir} — ${app.framework}`)
    }
  }
  if (evidence.length > 0 || repoRoot === undefined) return evidence
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8')) as {
      workspaces?: unknown
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    // Single-package repos ONLY: a workspace root's dependencies are hoisted
    // noise (a react-router in the root of a monorepo says nothing about which
    // app ships it) — there the route-manifest inventory above is the signal.
    if (pkg.workspaces !== undefined || fs.existsSync(path.join(repoRoot, 'pnpm-workspace.yaml'))) {
      return evidence
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    for (const name of ['next', '@remix-run/react', 'react-router', 'react-router-dom']) {
      if (deps[name]) return [`root package.json depends on ${name}`]
    }
  } catch {
    // No readable root package.json — no browser evidence from it.
  }
  return evidence
}

function readDiscoveryInputs(repoRoot: string): {
  packageJson: string
  presentInputs: string[]
  apps?: RecipeAppInventoryEntry[]
  /** The raw manifest apps (routes included) — the deterministic proposer's
   *  workspace branch reads these; the briefing gets the trimmed `apps` view. */
  manifestApps?: RouteManifestApp[]
} {
  const pkgPath = path.join(repoRoot, 'package.json')
  const packageJson = fs.existsSync(pkgPath) ? fs.readFileSync(pkgPath, 'utf-8') : '(no package.json)'
  const presentInputs = DISCOVERY_INPUTS.filter((f) => fs.existsSync(path.join(repoRoot, f)))
  // The workspace app inventory. A single-package repo yields none and the
  // prompt is byte-identical to what it was; a monorepo gets the one fact that lets
  // the model propose `api.servers` at all — that a second HTTP service exists.
  const manifestApps = buildRouteManifest(repoRoot).apps
  const apps = manifestApps.map((app) => ({
    dir: app.dir,
    ...(app.pkg ? { pkg: app.pkg } : {}),
    framework: app.framework,
    prefixes: app.prefixes.slice(0, 6),
  }))
  return {
    packageJson,
    presentInputs,
    ...(apps.length > 0 ? { apps, manifestApps } : {}),
  }
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
