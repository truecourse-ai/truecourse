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
  BUILD_PASSTHROUGH,
  type Recipe,
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
import { proposeRecipe, detectEcosystems, type ApiRouteRef } from './recipe-propose.js'
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
      /** The generated datastore compose file (item 68), repo-root-relative, when
       *  discovery wrote one alongside the recipe. Both are artifacts to review. */
      composePath?: string
    }
  // `proposal` is absent when the model never produced a valid one (invalid output
  // after one corrective re-ask, or a thrown call) — there's nothing to show.
  | { status: 'verify-failed'; reason: string; proposal?: RecipeProposal }

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
   * The datastore connection URLs the app declares in its source (item 68), off the
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
  // The datastore hint is resolved at most ONCE per discovery and only when a boot
  // failed — memoized here so the deterministic proposal and the model's retries
  // share one answer (and one analysis pass).
  let databaseOnce: Promise<DatabaseDependencyHint | null> | null = null
  const verifyContext: VerifyContext = options.database
    ? { database: () => (databaseOnce ??= Promise.resolve(options.database!()).catch(() => null)) }
    : {}
  const derived = proposeRecipe(repoRoot, {
    routes: options.routes ? [...(await options.routes())] : undefined,
    datastores: options.datastores ? [...(await options.datastores())] : undefined,
  })
  if (derived.ok) {
    // The generated datastore (item 68) must be ON DISK before verification: the
    // `services.up` command references it by path. It is written, verified with the
    // rest of the proposal, and put back exactly as it was if the proposal fails —
    // the item-66 write-then-restore rule, so a refused run leaves the tree
    // byte-identical.
    const compose = derived.compose ? writeComposeFile(repoRoot, derived.compose) : null
    const verdict = await verifyProposal(repoRoot, derived.recipe, verifyContext)
    if (verdict.ok) {
      return {
        status: 'discovered',
        recipe: derived.recipe,
        ...writeRecipeFile(repoRoot, derived.recipe),
        source: 'deterministic',
        todos: derived.todos,
        ...(compose ? { composePath: compose.rel } : {}),
      }
    }
    compose?.revert()
    // Every LATER verification in this discovery (the model's proposals, which can
    // carry no `services` at all) now knows a generated datastore was already tried
    // and did not work — so the guided failure never advises what guard just did.
    if (compose) verifyContext.composeGenerated = true
    deterministicFailure = verdict.reason
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

  let verdict = await verifyProposal(repoRoot, proposal, verifyContext)
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
      verdict = await verifyProposal(repoRoot, proposal, verifyContext)
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

/**
 * Write the generated datastore compose file (item 68) where the proposal's
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

/** One proposal's deterministic verdict: it verified, or the engine's report on why not. */
export type ProposalVerdict = { ok: true } | { ok: false; reason: string }

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
    /** The multi-server shape (item 75) — EVERY entry must boot for the proposal to verify. */
    servers?: Record<
      string,
      { serve: readonly string[]; healthPath?: string; env?: Record<string, string>; cwd?: 'sandbox' | 'repo' }
    >
    /** The datastore bring-up/tear-down the deterministic proposer derives from a
     *  compose file. Never model-proposed — `RecipeApiProposalSchema` has no
     *  `services` — but verification runs whatever the proposal carries. */
    services?: { up: string; down?: string }
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

/** What verification may consult when composing a failure diagnostic. Lazy: a
 *  proposal that verifies never resolves any of it. */
export type VerifyContext = {
  database?: () => Promise<DatabaseDependencyHint | null>
  /**
   * Set once a GENERATED datastore (item 68) was written and verified in this
   * discovery and still failed. The guided message then drops "add a compose file"
   * as advice — guard already did, and it did not help.
   */
  composeGenerated?: boolean
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
        const up = await runBuild(repoRoot, api.services.up, proposal.env, SERVICES_TIMEOUT_MS)
        // A services failure is NOT a boot failure and must not read like one: a
        // missing docker daemon, an occupied port, an unpullable image all die
        // here, and the command's own output is the whole diagnostic.
        if (!up.ok) {
          const tail = up.output.trimEnd().split('\n').slice(-5).join(' / ')
          return {
            ok: false,
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
        const boot = await preflightApiServer({
          resolvedServe: resolveEntry(repoRoot, server.serve),
          displayServe: server.serve,
          ...(server.cwd === 'repo' ? { cwd: repoRoot } : {}),
          recipeEnv: { ...(proposal.env ?? {}), ...(api.env ?? {}), ...(server.env ?? {}) },
          healthPath: server.healthPath ?? DEFAULT_API_HEALTH_PATH,
          readyTimeoutMs: DEFAULT_API_READY_TIMEOUT_MS,
          ...(servers.length > 1 ? { label: server.name } : {}),
        })
        if (boot.ok) continue
        const bootReason = `api server \`${server.serve.join(' ')}\` did not start: ${boot.stderr}`
        // The datastore story, when there is one to tell: the analyzer saw a
        // database dependency and the proposal has no `services` to bring one up,
        // so the boot almost certainly died on a connection nobody could make.
        // Leads with WHY and what to do; the boot excerpt follows it.
        if (!api.services) {
          const database = await context.database?.().catch(() => null)
          if (database) {
            return { ok: false, reason: `${databaseGuidance(database, context.composeGenerated === true)}\n\n${bootReason}` }
          }
        }
        return { ok: false, reason: bootReason }
      }
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
  return { ok: true }
}

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
    // Item 68: when guard already GENERATED a compose file and the chain still
    // failed, "add a compose file" is advice guard just took — say what happened
    // instead, so the next thing the user tries is a new one.
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

function readDiscoveryInputs(repoRoot: string): {
  packageJson: string
  presentInputs: string[]
  apps?: RecipeAppInventoryEntry[]
} {
  const pkgPath = path.join(repoRoot, 'package.json')
  const packageJson = fs.existsSync(pkgPath) ? fs.readFileSync(pkgPath, 'utf-8') : '(no package.json)'
  const presentInputs = DISCOVERY_INPUTS.filter((f) => fs.existsSync(path.join(repoRoot, f)))
  // The workspace app inventory (item 76). A single-package repo yields none and the
  // prompt is byte-identical to what it was; a monorepo gets the one fact that lets
  // the model propose `api.servers` at all — that a second HTTP service exists.
  const apps = buildRouteManifest(repoRoot).apps.map((app) => ({
    dir: app.dir,
    ...(app.pkg ? { pkg: app.pkg } : {}),
    framework: app.framework,
    prefixes: app.prefixes.slice(0, 6),
  }))
  return { packageJson, presentInputs, ...(apps.length > 0 ? { apps } : {}) }
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
