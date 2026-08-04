/**
 * `truecourse guard setup` — the CHEAP preparation stage that runs between
 * `spec scan` and `guard generate`.
 *
 * Every environment fact guard needs used to be discovered as a byproduct of the most
 * expensive stage in the product, and FIXING any of them edits `recipe.json`, which
 * moves the recipe fingerprint, which re-authors sections that were already good.
 * Setup makes all of it knowable and fixable before the first extraction call.
 *
 * The steps, in order, and what each may do to the run:
 *   0    an LLM provider must be configured        — the CALLER's check (config lives
 *                                                    above this package); the adapter
 *                                                    fails before calling in.
 *   0.5  a corpus must exist                       — HARD: setup runs after scan.
 *   1    the recipe                                — THE ONLY HARD GATE. Discovery
 *                                                    (deterministic → LLM → verify by
 *                                                    running) plus a live endpoint
 *                                                    probe per declared server.
 *   2    detect                                    — one `mapJourneys` pass; free.
 *   3    the externals declaration skeleton        — SOFT, never blocks.
 *   4    the one seed (data AND auth)              — SOFT, never blocks.
 * The credential↔spec `satisfies` check is reported here too, where fixing it costs
 * nothing; `guard generate` keeps its own cheap re-validation because specs can move
 * between the two stages.
 *
 * IDEMPOTENT BY CONSTRUCTION. A bare run over a repo that already has a recipe and a
 * seed reports and no-ops. `refresh` re-derives; refreshing the SEED additionally
 * needs `confirmSeedReplace` to answer true, and the CLI's non-TTY path answers false
 * — a hand-edited seed script is never clobbered by a flag.
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  loadRecipe,
  recipePath,
  buildRouteManifest,
  resolveApiServers,
  loadResolvedExternals,
  RecipeSchema,
  type Recipe,
  type RecipeApiExternal,
} from '@truecourse/guard-runner'
import { parseSecuritySchemes, parseOpenApiSpec, type SecurityScheme } from '@truecourse/shared/openapi'
import type {
  DatastoreUrlRef,
  DetectedExternalService,
  GuardSetupExternalsStep,
  GuardSetupRecipeStep,
  GuardSetupReport,
  GuardSetupSeedStep,
  GuardSetupServerProbe,
} from '@truecourse/shared'
import { discoverRecipe } from './recipe-discovery.js'
import { routesFromJourneys, type ApiRouteRef } from './recipe-propose.js'
import { probeApiServers } from './endpoint-probe.js'
import { deriveExternalsSkeleton } from './externals-skeleton.js'
import { draftSeed, detectRoleColumns, seedDraftGate, type SeedDraftDatabase } from './seed-draft.js'
import { hasGuardUniverse, corpusOpenApiDocs, readCorpusAreaTags } from './section-plan.js'
import { recipeAuthCredentials, validateCredentialSatisfies } from './openapi-security.js'
import type { JourneyProvider } from './generate.js'
import type { RecipeRunner, SeedRunner } from './runners.js'

/** How many spec docs the seed draft is shown, and how much of each. */
const MAX_SPEC_EXCERPTS = 6
const SPEC_EXCERPT_CHARS = 1500

export interface GuardSetupOptions {
  repoRoot: string
  /** Journey mapping seam — the same one generate uses; see {@link JourneyProvider}. */
  journeys?: JourneyProvider
  recipeRunner: RecipeRunner
  seedRunner: SeedRunner
  /** Re-derive the recipe and re-draft the seed even when both already exist. */
  refresh?: boolean
  /**
   * Asked ONCE, and only when a refresh would REPLACE an existing `api.seed`. A seed
   * script is a committed, human-reviewed file: `--refresh` alone is not consent, and
   * a non-TTY caller answers false so a flag can never clobber a hand-edited script.
   */
  confirmSeedReplace?: () => Promise<boolean>
  signal?: AbortSignal
  // --- progress hooks ---
  onStep?: (step: GuardSetupStepKey, detail?: string) => void
  onStepDone?: (step: GuardSetupStepKey, detail?: string) => void
  // --- test seams ---
  /** Test seam for step 1's live probe; production boots the real server. */
  probe?: typeof probeApiServers
}

/** Stable step taxonomy, shared by the CLI tracker and the dashboard. */
export const GUARD_SETUP_STEPS = [
  { key: 'recipe', label: 'Deriving the recipe' },
  { key: 'detect', label: 'Detecting dependencies' },
  { key: 'externals', label: 'Declaring external APIs' },
  { key: 'seed', label: 'Preparing data + principals' },
] as const

export type GuardSetupStepKey = (typeof GUARD_SETUP_STEPS)[number]['key']

/** What the caller gets back: the persisted record plus the loaded recipe. */
export interface GuardSetupResult {
  report: GuardSetupReport
  /** The recipe setup ended with; null when the hard gate failed. */
  recipe: Recipe | null
}

/**
 * Run the whole stage. Never throws for a repo-shaped problem: step 0.5 and the
 * recipe gate come back as `status: 'failed'` with a reason, and every soft step
 * records its own outcome without demoting the run.
 */
export async function runGuardSetup(opts: GuardSetupOptions): Promise<GuardSetupResult> {
  const { repoRoot } = opts

  // Step 0.5 — the corpus. Setup is the SECOND link of a three-stage chain; without
  // the first there is nothing to derive roles, principals, or credentials against,
  // and half-completing would leave a recipe that no spec ever justified.
  if (!hasGuardUniverse(repoRoot)) {
    return failed(
      'No corpus found. `truecourse guard setup` runs after the spec scan — run `truecourse spec scan` first.',
    )
  }

  // ONE analysis pass feeds steps 1 (the route surface + the datastore diagnostic),
  // 2, 3 and 4 — memoized exactly as generate memoizes it.
  let mappedOnce: ReturnType<JourneyProvider> | null = null
  const mapOnce = (): ReturnType<JourneyProvider> => (mappedOnce ??= mapSafely(opts.journeys))

  // ---- Step 1: the recipe. THE ONLY HARD GATE. -----------------------------
  opts.onStep?.('recipe')
  // A REFRESH re-derives, and discovery writes what it derived — which knows nothing
  // about the blocks it never proposes (`api.seed`, `api.externals`,
  // `api.credentials`, `ownHosts`). Those are user- and setup-authored CAPABILITY
  // declarations; losing them to a refresh would be silent data loss, and it would
  // also defeat the seed confirmation below (a wiped `api.seed` is not a seed anyone
  // is asked about replacing). Captured before, merged back after.
  const authored = opts.refresh ? authoredBlocks(reloadRecipe(repoRoot)) : null
  const discovery = await discoverRecipe(repoRoot, opts.recipeRunner, {
    ...(opts.refresh ? { ignoreExisting: true } : {}),
    routes: async () => routesFromJourneys((await mapOnce()).journeys),
    database: async () => {
      const db = (await mapOnce()).database
      return db ? { type: db.type, driver: db.driver } : null
    },
    datastores: async () => (await mapOnce()).datastoreUrls ?? [],
  })
  if (discovery.status === 'verify-failed') {
    return failed(discovery.reason, {
      recipe: { status: 'failed', reason: discovery.reason },
    })
  }
  // Put the authored blocks back before ANYTHING reads the recipe again.
  const recipe =
    authored && discovery.status === 'discovered'
      ? (restoreAuthoredBlocks(repoRoot, authored) ?? discovery.recipe)
      : discovery.recipe
  const recipeStep: GuardSetupRecipeStep = {
    status: 'ok',
    outcome: discovery.status === 'exists' ? 'exists' : 'discovered',
    ...(discovery.status === 'discovered'
      ? {
          source: discovery.source,
          wrotePath: discovery.wrotePath,
          ...(discovery.composePath ? { composePath: discovery.composePath } : {}),
          ...(discovery.todos.length > 0 ? { todos: discovery.todos } : {}),
        }
      : {}),
  }

  // The live endpoint probe — the half verification does not do. See `endpoint-probe.ts`
  // for why any HTTP status (401 and 404 included) is a pass.
  const manifest = buildRouteManifest(repoRoot)
  const probes: GuardSetupServerProbe[] = recipe.api
    ? await (opts.probe ?? probeApiServers)({
        repoRoot,
        recipe,
        manifest,
        ...(opts.signal ? { signal: opts.signal } : {}),
      })
    : []
  if (probes.length > 0) recipeStep.probes = probes
  const deadServer = probes.find((p) => !p.ok)
  if (deadServer) {
    const reason =
      `the recipe's server "${deadServer.server}" is declared but not reachable: ${deadServer.error}. ` +
      `Every api scenario would fail identically against it, so setup stops here rather than preparing a world nothing can run in.`
    recipeStep.status = 'failed'
    recipeStep.reason = reason
    return failed(reason, { recipe: recipeStep })
  }
  opts.onStepDone?.('recipe', recipeSummary(recipeStep, probes))

  // ---- The credential↔spec check, reported where fixing it is free. --------
  const credentials = recipeAuthCredentials(recipe)
  const openApiDocs = corpusOpenApiDocs(repoRoot)
  const credentialSchemes = credentials.some((c) => c.satisfies)
    ? validateCredentialSatisfies(credentials, openApiDocs)
    : { errors: [], warnings: [] }

  // ---- Step 2: detect. Deterministic, free, no LLM. ------------------------
  opts.onStep?.('detect')
  const mapped = await mapOnce()
  const detectedExternals = mapped.externalServices ?? []
  const database = mapped.database ?? null
  const datastoreUrls = mapped.datastoreUrls ?? []
  opts.onStepDone?.(
    'detect',
    detectSummary(detectedExternals, database),
  )

  // ---- Step 3: externals. SOFT — it never blocks. --------------------------
  opts.onStep?.('externals')
  const externalsStep = applyExternalsSkeleton(repoRoot, recipe, detectedExternals)
  opts.onStepDone?.(
    'externals',
    `${externalsStep.declared.length} declared · ${externalsStep.unprovided.length} awaiting an account`,
  )

  // The recipe on disk may have changed under step 3 (the skeleton is a real write),
  // so the seed drafts against the RELOADED one — its fingerprint has already moved.
  const current = reloadRecipe(repoRoot) ?? recipe

  // ---- Step 4: the one seed — data AND auth. SOFT. -------------------------
  opts.onStep?.('seed')
  const seedStep = await runSeedStep({
    opts,
    recipe: current,
    database,
    routes: routesFromJourneys(mapped.journeys),
    schemes: collectSecuritySchemes(openApiDocs),
  })
  opts.onStepDone?.('seed', seedSummary(seedStep))

  return {
    recipe: reloadRecipe(repoRoot) ?? current,
    report: {
      ranAt: new Date().toISOString(),
      status: 'ok',
      recipe: recipeStep,
      externals: externalsStep,
      seed: seedStep,
      ...(credentialSchemes.errors.length > 0 || credentialSchemes.warnings.length > 0
        ? { credentialSchemes }
        : {}),
      detection: {
        externalServices: detectedExternals,
        database: database
          ? { type: database.type, driver: database.driver, tables: database.tables.length }
          : null,
        datastoreUrls,
      },
    },
  }
}

/** The recipe blocks discovery never proposes — the user's and setup's own work. */
interface AuthoredBlocks {
  seed?: unknown
  externals?: unknown
  credentials?: unknown
  ownHosts?: unknown
}

/** Capture them, or `null` when there is no recipe (nothing to preserve). */
function authoredBlocks(recipe: Recipe | null): AuthoredBlocks | null {
  if (!recipe) return null
  const api = recipe.api
  const blocks: AuthoredBlocks = {
    ...(api?.seed !== undefined ? { seed: api.seed } : {}),
    ...(api?.externals !== undefined ? { externals: api.externals } : {}),
    ...(api?.credentials !== undefined ? { credentials: api.credentials } : {}),
    ...(recipe.ownHosts !== undefined ? { ownHosts: recipe.ownHosts } : {}),
  }
  return Object.keys(blocks).length > 0 ? blocks : null
}

/**
 * Merge the captured blocks back into the freshly written recipe, re-validating the
 * WHOLE result. Returns the merged recipe, or `null` when the merge could not be
 * applied — in which case the caller keeps the derived recipe and the run carries on
 * (a refresh that cannot restore is a visible loss in `git diff`, never a crash).
 */
function restoreAuthoredBlocks(repoRoot: string, blocks: AuthoredBlocks): Recipe | null {
  const file = recipePath(repoRoot)
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf-8')
  } catch {
    return null
  }
  let doc: Record<string, unknown>
  try {
    doc = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
  if (blocks.ownHosts !== undefined) doc.ownHosts = blocks.ownHosts
  const api = doc.api as Record<string, unknown> | undefined
  if (api && typeof api === 'object') {
    if (blocks.seed !== undefined) api.seed = blocks.seed
    if (blocks.externals !== undefined) api.externals = blocks.externals
    if (blocks.credentials !== undefined) api.credentials = blocks.credentials
  }
  const validated = RecipeSchema.safeParse(doc)
  if (!validated.success) return null
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + (raw.endsWith('\n') ? '\n' : ''))
  return validated.data
}

// ---------------------------------------------------------------------------
// Step 3 — the externals skeleton write
// ---------------------------------------------------------------------------

/**
 * Derive the skeleton and, when it adds anything, patch `api.externals` into
 * `recipe.json`. The recipe is parsed, patched, and re-serialized in ITS OWN format
 * so the diff a reviewer reads is the declaration block and nothing else, and the
 * WHOLE result is re-validated before it lands.
 *
 * SOFT throughout: a recipe with no `api` block, an unparseable file, a write that
 * would invalidate the recipe — each is a reported `skipped`/`failed` step, never a
 * reason to abandon a run whose hard gate already held.
 */
function applyExternalsSkeleton(
  repoRoot: string,
  recipe: Recipe,
  detected: readonly DetectedExternalService[],
): GuardSetupExternalsStep {
  const base = { declared: [] as string[], alreadyDeclared: [] as string[], undeclarable: [] as string[] }
  if (!recipe.api) {
    return {
      ...base,
      status: 'skipped',
      reason: 'the recipe has no `api` block — external services configure the api driver',
      unprovided: [],
    }
  }
  const skeleton = deriveExternalsSkeleton(recipe, detected)
  const added = Object.keys(skeleton.declare).sort()
  if (added.length > 0) {
    const written = writeExternals(repoRoot, skeleton.declare)
    if (written !== null) {
      return {
        status: 'failed',
        reason: written,
        declared: [],
        alreadyDeclared: skeleton.alreadyDeclared,
        undeclarable: skeleton.undeclarable,
        unprovided: unprovidedServices(repoRoot, recipe),
      }
    }
  }
  return {
    status: 'ok',
    declared: added,
    alreadyDeclared: skeleton.alreadyDeclared,
    undeclarable: skeleton.undeclarable,
    unprovided: unprovidedServices(repoRoot, reloadRecipe(repoRoot) ?? recipe),
  }
}

/** Patch the declarations in; returns `null` on success or the refusal reason. */
function writeExternals(repoRoot: string, declare: Record<string, RecipeApiExternal>): string | null {
  const file = recipePath(repoRoot)
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf-8')
  } catch (e) {
    return `recipe.json could not be read: ${(e as Error).message}`
  }
  let doc: Record<string, unknown>
  try {
    doc = JSON.parse(raw) as Record<string, unknown>
  } catch (e) {
    return `recipe.json is not valid JSON: ${(e as Error).message}`
  }
  const api = doc.api as Record<string, unknown> | undefined
  if (!api || typeof api !== 'object') return 'recipe.json has no `api` block'
  const externals = { ...((api.externals as Record<string, RecipeApiExternal>) ?? {}), ...declare }
  api.externals = Object.fromEntries(Object.keys(externals).sort().map((k) => [k, externals[k]]))
  const validated = RecipeSchema.safeParse(doc)
  if (!validated.success) {
    return `declaring the detected services would make recipe.json invalid: ${validated.error.issues
      .map((i) => `${i.path.join('.')} ${i.message}`)
      .join('; ')}`
  }
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + (raw.endsWith('\n') ? '\n' : ''))
  return null
}

/** Declared services with nothing resolvable behind them yet — the honest to-do list. */
function unprovidedServices(repoRoot: string, recipe: Recipe): string[] {
  try {
    return loadResolvedExternals(repoRoot, recipe.api?.externals)
      .filter((e) => e.state !== 'provided')
      .map((e) => e.service)
      .sort()
  } catch {
    // A broken overlay is the externals command's problem to report, not a reason
    // for the setup record to be wrong — report nothing rather than something false.
    return []
  }
}

// ---------------------------------------------------------------------------
// Step 4 — the one seed
// ---------------------------------------------------------------------------

async function runSeedStep(args: {
  opts: GuardSetupOptions
  recipe: Recipe
  database: SeedDraftDatabase | null
  routes: readonly ApiRouteRef[]
  schemes: { name: string; summary: string }[]
}): Promise<GuardSetupSeedStep> {
  const { opts, recipe, database, routes, schemes } = args
  const existing = recipe.api?.seed

  // Idempotence: a repo that already has a seed and did not ask for a refresh is
  // REPORTED, not re-drafted. That is the whole "bare setup no-ops" contract.
  if (existing && !opts.refresh) {
    return {
      status: 'ok',
      outcome: 'exists',
      command: existing.command,
      ...(existing.script ? { scriptPath: existing.script } : {}),
      ...declaredNames(existing),
    }
  }

  let replaceExisting = false
  if (existing) {
    // `--refresh` is not consent to overwrite a hand-edited script; the caller is
    // asked, and a non-TTY caller answers false.
    replaceExisting = (await opts.confirmSeedReplace?.()) ?? false
    if (!replaceExisting) {
      return {
        status: 'skipped',
        outcome: 'exists',
        reason:
          'the recipe already declares `api.seed` and replacing it was not confirmed — the existing seed script is untouched',
        command: existing.command,
        ...(existing.script ? { scriptPath: existing.script } : {}),
        ...declaredNames(existing),
      }
    }
  }

  // The cheap refusals BEFORE anything is drafted, so the reason a user reads is the
  // real one (no api block, no schema) rather than a model failure downstream.
  const gate = seedDraftGate({
    recipe,
    database,
    ...(replaceExisting ? { replaceExisting: true } : {}),
  })
  if (!gate.ok) return { status: 'skipped', reason: gate.reason }

  const result = await draftSeed({
    repoRoot: opts.repoRoot,
    recipe,
    database,
    runner: opts.seedRunner,
    routes: routes.map((r) => ({ method: r.method, path: r.path })),
    ...(schemes.length > 0 ? { securitySchemes: schemes } : {}),
    roles: database ? detectRoleColumns(database) : [],
    specExcerpts: readSpecExcerpts(opts.repoRoot),
    probePaths: probeablePaths(routes),
    ...(replaceExisting ? { replaceExisting: true } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  })

  if (result.status === 'drafted') {
    return {
      status: 'ok',
      outcome: 'drafted',
      scriptPath: result.scriptPath,
      command: result.seed.command,
      ...declaredNames(result.seed),
    }
  }
  return { status: result.status === 'failed' ? 'failed' : 'skipped', reason: result.reason }
}

/** The fixture/credential names a seed declares, sorted, omitted when empty. */
function declaredNames(seed: {
  provides: { fixtures?: Record<string, unknown>; credentials?: Record<string, unknown> }
}): { fixtures?: string[]; credentials?: string[] } {
  const fixtures = Object.keys(seed.provides.fixtures ?? {}).sort()
  const credentials = Object.keys(seed.provides.credentials ?? {}).sort()
  return {
    ...(fixtures.length > 0 ? { fixtures } : {}),
    ...(credentials.length > 0 ? { credentials } : {}),
  }
}

/** Parameter-free GET paths — the seed's soft post-draft probe candidates. */
function probeablePaths(routes: readonly ApiRouteRef[]): string[] {
  return routes
    .filter((r) => r.method.toUpperCase() === 'GET' && !/[{:]/.test(r.path))
    .map((r) => r.path)
    .slice(0, 5)
}

/**
 * Short excerpts of the curated specs — the ROLE and PRINCIPAL language the schema
 * cannot supply. Deliberately bounded and deliberately dumb (the head of each doc):
 * the schema stays the authority on what is creatable, and this only has to tell the
 * model that "org owner" and "member" are words this product uses.
 */
export function readSpecExcerpts(repoRoot: string): { doc: string; text: string }[] {
  const out: { doc: string; text: string }[] = []
  for (const ref of readCorpusAreaTags(repoRoot).keys()) {
    if (out.length >= MAX_SPEC_EXCERPTS) break
    let content: string
    try {
      content = fs.readFileSync(path.resolve(repoRoot, ref), 'utf-8')
    } catch {
      continue
    }
    out.push({ doc: ref, text: content.slice(0, SPEC_EXCERPT_CHARS) })
  }
  return out
}

/** The corpus's OpenAPI security schemes as the prompt's CLOSED SET of names. */
export function collectSecuritySchemes(
  docs: readonly { doc: string; content: string }[],
): { name: string; summary: string }[] {
  const byName = new Map<string, string>()
  for (const { content } of docs) {
    const parsed = parseOpenApiSpec(content)
    for (const [name, scheme] of Object.entries(parseSecuritySchemes(parsed))) {
      if (!byName.has(name)) byName.set(name, summarizeScheme(scheme))
    }
  }
  return [...byName].sort(([a], [b]) => a.localeCompare(b)).map(([name, summary]) => ({ name, summary }))
}

function summarizeScheme(scheme: SecurityScheme): string {
  if (scheme.type === 'apiKey') return `apiKey in ${scheme.in ?? 'header'} named ${scheme.name ?? '(unnamed)'}`
  if (scheme.type === 'http') return `http ${scheme.scheme ?? '(unspecified)'}`
  return scheme.type
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The recipe as it is on disk right now — steps 3 and 4 both write to it. */
function reloadRecipe(repoRoot: string): Recipe | null {
  try {
    return loadRecipe(repoRoot, recipePath(repoRoot))?.recipe ?? null
  } catch {
    return null
  }
}

/** A failure of step 0.5 or the recipe gate — nothing downstream ran. */
function failed(reason: string, parts: { recipe?: GuardSetupRecipeStep } = {}): GuardSetupResult {
  return {
    recipe: null,
    report: {
      ranAt: new Date().toISOString(),
      status: 'failed',
      reason,
      recipe: parts.recipe ?? { status: 'skipped', reason },
    },
  }
}

/** The journey mapping, degraded to "nothing detected" rather than a failed setup. */
async function mapSafely(provider?: JourneyProvider): Promise<{
  journeys: Awaited<ReturnType<JourneyProvider>>['journeys']
  externalServices: DetectedExternalService[]
  database: SeedDraftDatabase | null
  datastoreUrls: DatastoreUrlRef[]
}> {
  const empty = { journeys: [], externalServices: [], database: null, datastoreUrls: [] }
  if (!provider) return empty
  try {
    const mapped = await provider()
    return {
      journeys: mapped.journeys,
      externalServices: mapped.externalServices ?? [],
      database: mapped.database ?? null,
      datastoreUrls: mapped.datastoreUrls ?? [],
    }
  } catch {
    return empty
  }
}

function recipeSummary(step: GuardSetupRecipeStep, probes: readonly GuardSetupServerProbe[]): string {
  const head = step.outcome === 'discovered' ? `wrote ${step.wrotePath} (${step.source})` : 'already present'
  if (probes.length === 0) return head
  const reached = probes.map((p) => `${p.server} ${p.path} → ${p.status ?? '—'}`).join(' · ')
  return `${head} · ${reached}`
}

function detectSummary(externals: readonly DetectedExternalService[], database: SeedDraftDatabase | null): string {
  const parts = [`${externals.length} external service${externals.length === 1 ? '' : 's'}`]
  parts.push(database ? `${database.driver} (${database.tables.length} tables)` : 'no database')
  return parts.join(' · ')
}

function seedSummary(step: GuardSetupSeedStep): string {
  if (step.status !== 'ok') return step.reason ?? 'skipped'
  const parts: string[] = [step.outcome === 'drafted' ? `wrote ${step.scriptPath}` : 'already present']
  if (step.fixtures?.length) parts.push(`${step.fixtures.length} fixture${step.fixtures.length === 1 ? '' : 's'}`)
  if (step.credentials?.length) {
    parts.push(`${step.credentials.length} principal${step.credentials.length === 1 ? '' : 's'}`)
  }
  return parts.join(' · ')
}
