/**
 * SEED DRAFTING (item 66, generalized by item 77) — the LLM writes the `api.seed` a
 * repo needs, the ENGINE proves it works, and only then do two reviewable artifacts
 * land in the working tree: a seed SCRIPT file and the `api.seed` block in
 * `recipe.json`.
 *
 * ONE ARTIFACT COVERS DATA AND AUTH. `provides` emits both `fixtures` (the rows) and
 * `credentials` (the principals), because creating the test principal IS data seeding
 * — a login token cannot be minted without a user row — and splitting them would put
 * half the preparation behind the other half.
 *
 * The shape is `recipe-discovery.ts`'s, deliberately: propose → verify by actually
 * RUNNING it → ONE evidence retry carrying the engine's own diagnostic → write only
 * on success. Nothing here executes model text against the repo without putting the
 * tree back when it fails.
 *
 * THE GATE (all of it, or the stage never fires — and says which part did not hold):
 *   a. the recipe has an `api` block (a seed prepares the api driver's world),
 *   b. a database with a PARSED SCHEMA was detected (the whole grounding),
 *   c. the recipe has NO `api.seed` — UNLESS the caller explicitly confirmed a
 *      replacement (`guard setup --refresh`, which prompts; a non-TTY refuses).
 * Item 66's fourth condition — "some flow settled blocked-on missing data" — is GONE:
 * it was an AUTHORING output, and `guard setup` runs before authoring has ever run.
 * The blocked list survives as optional grounding.
 *
 * VERIFICATION runs the real thing, in the order a guard run does:
 *   `api.services.up` (the seed's declared prerequisite) → the script, spawned by
 *   the runner's own `runSeed` with `GUARD_SEED_OUT` set and the manifest validated
 *   against the drafted `provides` by the runner's own resolver → the server booted
 *   through `preflightApiServer`, optionally probing one path as a SOFT signal (a 4xx
 *   is fine — the fixtures are not in the URL; only the boot is a verdict).
 *
 * The script is written at its FINAL path for verification (it has to be: the
 * command names that path, and the script imports the app's own modules, which only
 * resolve inside the tree) and the tree is RESTORED on any failure — deleted when the
 * path was free, put back byte-for-byte when a replacement was overwriting one. A
 * path that already exists is refused unless it is the script being replaced.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { getCacheEntry, setCacheEntry } from '@truecourse/llm'
import {
  runBuild,
  runSeed,
  resolveEntry,
  preflightApiServer,
  computeRecipeFingerprint,
  recipePath,
  RecipeSchema,
  SeedError,
  resolveApiServers,
  DEFAULT_BUILD_TIMEOUT_MS,
  type Recipe,
  type RecipeApiSeed,
} from '@truecourse/guard-runner'
import { SeedProposalSchema, type SeedProposal } from './schemas.js'
import {
  SEED_PROMPT_FINGERPRINT,
  type SeedBlockedClaim,
  type SeedDraftInput,
  type SeedRetryContext,
} from './prompts.js'
import { flattenZodError, quoteInvalidOutput } from './validate.js'
import { detectEcosystems, type RecipeEcosystem } from './recipe-propose.js'
import type { SeedRunner } from './runners.js'

export const SEED_CACHE_NAME = 'guard/seed'

/** How long the drafted seed may take before verification calls it hung. */
const SEED_TIMEOUT_MS = DEFAULT_BUILD_TIMEOUT_MS

/** The parsed schema the draft is grounded in — the analyzer's own output. */
export interface SeedDraftDatabase {
  /** `postgres`, `sqlite`, … */
  type: string
  /** The ORM/driver the analyzer matched (`prisma`, `drizzle-orm`, `sqlalchemy`, …). */
  driver: string
  tables: {
    name: string
    columns: {
      name: string
      type: string
      isNullable?: boolean
      isPrimaryKey?: boolean
      isUnique?: boolean
      defaultValue?: string
      isForeignKey?: boolean
      referencesTable?: string
      referencesColumn?: string
    }[]
  }[]
  relations: { sourceTable: string; targetTable: string; foreignKeyColumn: string }[]
  /** How the app's own files import the client — the draft must import it the same way. */
  appImports: string[]
}

/** One flow this generate could not author because the data does not exist. */
export type SeedBlockedFlow = SeedBlockedClaim

export interface DraftSeedOptions {
  repoRoot: string
  recipe: Recipe
  /**
   * Flows a previous generate settled `blocked-on` missing data. OPTIONAL grounding
   * since item 77 — no longer the trigger, because setup drafts before authoring.
   */
  blocked?: readonly SeedBlockedFlow[]
  /** The detected datastore + its parsed schema (gate (b)); `null` = nothing detected. */
  database: SeedDraftDatabase | null
  runner: SeedRunner
  /**
   * GET paths probed as a SOFT signal after the server boots. A non-2xx never fails
   * verification — only a boot failure does.
   */
  probePaths?: readonly string[]
  /**
   * The app's route surface (item 77) — what the tests will drive, so what the
   * fixtures must make reachable. Capped before it reaches the prompt.
   */
  routes?: readonly { method: string; path: string }[]
  /**
   * The OpenAPI security schemes the corpus declares (B7). A CLOSED SET: a drafted
   * credential's `satisfies` is filtered against these names before anything is
   * written, so an invented one can never reach `recipe.json`.
   */
  securitySchemes?: readonly { name: string; summary: string }[]
  /** The roles to mint one principal each for; empty ⇒ one principal. */
  roles?: readonly { name: string; source: string }[]
  /** Short spec excerpts, for the role/principal LANGUAGE only. */
  specExcerpts?: readonly { doc: string; text: string }[]
  /**
   * Replace an existing `api.seed` (`guard setup --refresh`, after the caller
   * confirmed). Without it an existing seed is refused — a seed is a committed,
   * human-reviewed file and is never silently overwritten.
   */
  replaceExisting?: boolean
  signal?: AbortSignal
}

export type DraftSeedResult =
  /** A gate did not hold — nothing was called, nothing was written. */
  | { status: 'skipped'; reason: string }
  /** Two drafts ran and neither verified; the tree is exactly as it was. */
  | { status: 'failed'; reason: string; proposal?: SeedProposal }
  | {
      status: 'drafted'
      /** Repo-relative path of the written script. */
      scriptPath: string
      /** The `api.seed` block patched into recipe.json (carries `script`). */
      seed: RecipeApiSeed
      /** Repo-relative path of the patched recipe. */
      recipePath: string
      /** The recipe fingerprint AFTER the patch — the value that re-authors. */
      fingerprint: string
    }

/**
 * The gate, as a pure predicate over what a caller already has. Separated so the
 * engine and the cheap pre-analysis check in `guard setup` apply the identical rule
 * and print the identical reason.
 */
export function seedDraftGate(input: {
  recipe: Recipe | null
  /**
   * The detected datastore, `null` when detection found none — and `undefined`
   * when it HAS NOT RUN YET. The last is what a caller passes to decide the
   * recipe-shaped refusals (no api block, a seed already declared) BEFORE paying
   * for an analysis pass; gate (b) is re-checked with the real answer a moment later.
   */
  database?: SeedDraftDatabase | null
  /** The caller confirmed a replacement of an existing `api.seed`. */
  replaceExisting?: boolean
}): { ok: true } | { ok: false; reason: string } {
  if (!input.recipe) {
    return { ok: false, reason: 'no recipe.json — run `truecourse guard setup` first' }
  }
  if (!input.recipe.api) {
    return {
      ok: false,
      reason: 'the recipe has no `api` block — a seed prepares state for the api driver',
    }
  }
  if (input.recipe.api.seed && !input.replaceExisting) {
    return {
      ok: false,
      reason:
        'the recipe already declares `api.seed` — an existing seed is a committed, human-reviewed file and is never silently overwritten (`truecourse guard setup --refresh` replaces it, with a confirmation)',
    }
  }
  if (input.database === undefined) return { ok: true }
  if (!input.database || input.database.tables.length === 0) {
    return {
      ok: false,
      reason: input.database
        ? `a ${input.database.driver} datastore was detected but no schema could be parsed — a seed cannot be drafted against an unknown schema`
        : 'no database was detected in this repository — a seed writes rows, so it needs one',
    }
  }
  return { ok: true }
}

/**
 * Draft, verify, and (only on success) write the seed. Every failure is reported,
 * never thrown: a seed that could not be drafted is a stated gap, not a broken
 * generate.
 */
export async function draftSeed(opts: DraftSeedOptions): Promise<DraftSeedResult> {
  const { repoRoot, recipe, database } = opts
  const gate = seedDraftGate({
    recipe,
    database,
    ...(opts.replaceExisting ? { replaceExisting: true } : {}),
  })
  if (!gate.ok) return { status: 'skipped', reason: gate.reason }
  // Narrowed by the gate; restated for the type checker.
  if (!database || !recipe.api) return { status: 'skipped', reason: 'gate' }

  const input = buildDraftInput(repoRoot, opts, database)
  const cacheKey = seedCacheKey(repoRoot, input)

  let proposal: SeedProposal | null = null
  const cached = await getCacheEntry(repoRoot, SEED_CACHE_NAME, cacheKey)
  if (cached) {
    const parsed = SeedProposalSchema.safeParse(cached)
    if (parsed.success) proposal = parsed.data
  }
  if (!proposal) {
    const attempt = await draftWithReask(input, opts.runner)
    if ('error' in attempt) return { status: 'failed', reason: attempt.error }
    proposal = attempt.proposal
    await setCacheEntry(repoRoot, SEED_CACHE_NAME, cacheKey, proposal)
  }

  let verdict = await verifyDraft(opts, proposal)
  if (!verdict.ok) {
    // ONE evidence retry, the house pattern: the engine's own report goes back
    // verbatim and the replacement is verified in full, from services.up onwards.
    const retried = await draftWithReask(input, opts.runner, {
      proposal: JSON.stringify(proposal, null, 2),
      failure: verdict.reason,
    })
    if (!('error' in retried)) {
      proposal = retried.proposal
      verdict = await verifyDraft(opts, proposal)
      // A draft that VERIFIED replaces the rejected one under the round-1 key, so a
      // later run reuses what worked instead of re-paying the retry.
      if (verdict.ok) await setCacheEntry(repoRoot, SEED_CACHE_NAME, cacheKey, proposal)
    }
  }
  if (!verdict.ok) return { status: 'failed', reason: verdict.reason, proposal }

  return writeSeedArtifacts(repoRoot, proposal, knownSchemes(opts))
}

/** The security-scheme names a drafted `satisfies` may name; empty ⇒ none survive. */
function knownSchemes(opts: DraftSeedOptions): Set<string> {
  return new Set((opts.securitySchemes ?? []).map((s) => s.name))
}

// ---------------------------------------------------------------------------
// The draft call
// ---------------------------------------------------------------------------

/**
 * The cache key: the prompt fingerprint, the recipe fingerprint, and EVERY grounding
 * input the draft is derived from — the schema, the route surface, the security
 * schemes, the roles, the spec excerpts, and the blocked claims. A re-run over an
 * unchanged repo re-pays nothing; any of them moving re-drafts. The retry evidence
 * and the corrective re-ask are deliberately excluded — they are round-2 inputs, and
 * a verified retry replaces the rejected round-1 entry under this same key.
 */
function seedCacheKey(repoRoot: string, input: SeedDraftInput): string {
  const groundingHash = createHash('sha256')
    .update(
      JSON.stringify({
        driver: input.driver,
        databaseType: input.databaseType,
        tables: input.tables,
        relations: input.relations,
        connectionEnv: input.connectionEnv,
        appImports: input.appImports,
        blocked: input.blocked,
        routes: input.routes ?? [],
        securitySchemes: input.securitySchemes ?? [],
        roles: input.roles ?? [],
        specExcerpts: input.specExcerpts ?? [],
        replacing: input.replacing?.scriptContent ?? '',
      }),
    )
    .digest('hex')
  return createHash('sha256')
    .update([SEED_PROMPT_FINGERPRINT, groundingHash, computeRecipeFingerprint(repoRoot)].join('::'))
    .digest('hex')
}

/** Ask for a draft and validate it; a schema failure re-asks ONCE with the invalid
 *  output quoted back. A thrown call is never re-asked. */
async function draftWithReask(
  input: SeedDraftInput,
  runner: SeedRunner,
  retry?: SeedRetryContext,
): Promise<{ proposal: SeedProposal } | { error: string }> {
  const base: SeedDraftInput = retry ? { ...input, retry } : input
  let raw: unknown
  try {
    raw = await runner(base)
  } catch (e) {
    return { error: `seed draft call failed: ${(e as Error).message}` }
  }
  const parsed = SeedProposalSchema.safeParse(raw)
  if (parsed.success) return { proposal: parsed.data }

  let reRaw: unknown
  try {
    reRaw = await runner({ ...base, correction: { invalidOutput: quoteInvalidOutput(raw) } })
  } catch (e) {
    return { error: `seed draft re-ask failed: ${(e as Error).message}` }
  }
  const reParsed = SeedProposalSchema.safeParse(reRaw)
  if (reParsed.success) return { proposal: reParsed.data }
  return { error: `seed draft invalid after re-ask: ${flattenZodError(reParsed.error)}` }
}

/** How many routes the draft prompt is shown — enough to ground fixtures, not a dump. */
const MAX_PROMPT_ROUTES = 60

function buildDraftInput(
  repoRoot: string,
  opts: DraftSeedOptions,
  database: SeedDraftDatabase,
): SeedDraftInput {
  const { recipe } = opts
  const ecosystem = detectEcosystems(repoRoot)[0] ?? 'js'
  const existingScript = readExistingSeedScript(repoRoot, recipe)
  return {
    driver: database.driver,
    databaseType: database.type,
    tables: database.tables,
    relations: database.relations,
    connectionEnv: connectionEnvVars(recipe),
    appImports: database.appImports,
    blocked: (opts.blocked ?? []).map((b) => ({ flow: b.flow, needs: [...b.needs] })),
    ...(opts.routes && opts.routes.length > 0
      ? { routes: opts.routes.slice(0, MAX_PROMPT_ROUTES).map((r) => ({ method: r.method, path: r.path })) }
      : {}),
    ...(opts.securitySchemes && opts.securitySchemes.length > 0
      ? { securitySchemes: opts.securitySchemes.map((s) => ({ ...s })) }
      : {}),
    ...(opts.roles && opts.roles.length > 0 ? { roles: opts.roles.map((r) => ({ ...r })) } : {}),
    ...(opts.specExcerpts && opts.specExcerpts.length > 0
      ? { specExcerpts: opts.specExcerpts.map((e) => ({ ...e })) }
      : {}),
    ...(existingScript ? { replacing: existingScript } : {}),
    ecosystem,
    suggestedPath: existingScript?.scriptPath ?? suggestedScriptPath(ecosystem),
  }
}

/**
 * The seed script this repo already has, when one is being REPLACED. Read here so
 * the draft improves on it rather than guessing afresh; absent (no seed, no `script`
 * field, an unreadable file) simply means there is nothing to improve on.
 */
function readExistingSeedScript(
  repoRoot: string,
  recipe: Recipe,
): { scriptPath: string; scriptContent: string } | null {
  const scriptPath = recipe.api?.seed?.script
  if (!scriptPath) return null
  const target = resolveScriptPath(repoRoot, scriptPath)
  if ('reason' in target || !fs.existsSync(target.abs)) return null
  try {
    return { scriptPath, scriptContent: fs.readFileSync(target.abs, 'utf-8') }
  } catch {
    return null
  }
}

/**
 * Role-shaped columns of the parsed schema — the deterministic half of "one
 * principal per role". A column named `role`/`roles`/`type`/`kind` on a
 * PRINCIPAL-SHAPED table (one that also carries an email/username/password column)
 * is what an app uses to distinguish who is acting; its enumerated type or default
 * value carries the role NAMES when the parser captured them.
 *
 * Deliberately narrow: it may only ever report roles it can SEE. A schema with no
 * such column yields none, and the draft mints one principal — which is the honest
 * default, not a degradation.
 */
export function detectRoleColumns(database: SeedDraftDatabase): { name: string; source: string }[] {
  const out: { name: string; source: string }[] = []
  const seen = new Set<string>()
  for (const table of database.tables) {
    const names = new Set(table.columns.map((c) => c.name.toLowerCase()))
    const principal = ['email', 'username', 'password', 'password_hash', 'passwordhash'].some((c) =>
      names.has(c),
    )
    if (!principal) continue
    for (const column of table.columns) {
      if (!/^(roles?|type|kind)$/i.test(column.name)) continue
      const source = `${table.name}.${column.name}`
      for (const value of enumeratedValues(column.type, column.defaultValue)) {
        if (seen.has(value)) continue
        seen.add(value)
        out.push({ name: value, source })
      }
    }
  }
  return out
}

/** The literal values an enum-ish column type (or its default) names, if any. */
function enumeratedValues(type: string, defaultValue: string | undefined): string[] {
  const values = new Set<string>()
  // `enum('admin','user')`, `ENUM("owner", "member")`, `role_enum` variants — the
  // quoted literals are the only thing read, so an unparsed type contributes nothing.
  for (const match of type.matchAll(/['"]([A-Za-z][A-Za-z0-9_-]*)['"]/g)) values.add(match[1])
  if (values.size === 0 && defaultValue) {
    const literal = /^['"]?([A-Za-z][A-Za-z0-9_-]*)['"]?$/.exec(defaultValue.trim())
    if (literal) values.add(literal[1])
  }
  return [...values]
}

/** Env vars the recipe itself declares that look like a datastore connection —
 *  what the app reads, so what the seed must read. Names only; never values. */
function connectionEnvVars(recipe: Recipe): string[] {
  const names = new Set<string>([...Object.keys(recipe.env ?? {}), ...Object.keys(recipe.api?.env ?? {})])
  return [...names].filter((n) => /(?:DATABASE|DB|POSTGRES|MYSQL|MONGO|REDIS|SQLITE)/i.test(n)).sort()
}

/** Where a drafted script goes, in the repo's own conventions. A SUGGESTION — the
 *  proposal names the real path, and an occupied path is refused at write time. */
function suggestedScriptPath(ecosystem: RecipeEcosystem): string {
  if (ecosystem === 'python') return 'scripts/guard_seed.py'
  if (ecosystem === 'dotnet') return 'scripts/guard-seed.csx'
  return 'scripts/guard-seed.mjs'
}

// ---------------------------------------------------------------------------
// Verification — the engine RUNS the draft
// ---------------------------------------------------------------------------

type DraftVerdict = { ok: true } | { ok: false; reason: string }

async function verifyDraft(opts: DraftSeedOptions, proposal: SeedProposal): Promise<DraftVerdict> {
  const { repoRoot, recipe } = opts
  const api = recipe.api
  if (!api) return { ok: false, reason: 'the recipe has no `api` block' }

  const target = resolveScriptPath(repoRoot, proposal.scriptPath)
  if ('reason' in target) return { ok: false, reason: target.reason }
  // The one path a draft may legitimately land on top of: the script THIS seed is
  // replacing (`--refresh`, already confirmed). Its bytes are captured so a rejected
  // replacement puts the working tree back exactly as it was.
  const replacingPath = opts.replaceExisting ? recipe.api?.seed?.script : undefined
  const overwriting = replacingPath !== undefined && path.resolve(repoRoot, replacingPath) === target.abs
  const previousBytes = overwriting && fs.existsSync(target.abs) ? fs.readFileSync(target.abs) : null
  if (fs.existsSync(target.abs) && !overwriting) {
    return {
      ok: false,
      reason: `${proposal.scriptPath} already exists — propose a path this repository does not use yet`,
    }
  }

  const seed = toRecipeSeed(proposal, knownSchemes(opts))
  // The seed prepares the world the DEFAULT server boots into (item 75): with one
  // server that is the only server; with several it is the one a scenario means
  // when it names none — the same choice `run.ts` makes for the shared world.
  const resolvedServers = resolveApiServers(recipe)
  const server = resolvedServers.servers.get(resolvedServers.defaultServer)
  if (!server) return { ok: false, reason: 'the recipe declares no api server to verify the seed against' }
  const seedEnv = server.env
  let servicesUp = false
  try {
    // The seed's declared prerequisite. When the recipe declares none, the datastore
    // is the user's to have running — the same assumption `guard run` makes — and a
    // connection failure comes back as the seed's own loud diagnostic, never a hang.
    if (api.services) {
      const up = await runBuild(repoRoot, api.services.up, recipe.env, SEED_TIMEOUT_MS, opts.signal)
      if (!up.ok) {
        return {
          ok: false,
          reason: `\`${api.services.up}\` failed${up.timedOut ? ' (timed out)' : ''}: ${tail(up.output)}`,
        }
      }
      servicesUp = true
    }

    fs.mkdirSync(path.dirname(target.abs), { recursive: true })
    fs.writeFileSync(target.abs, proposal.scriptContent)

    // The REAL runner path: spawn the command with GUARD_SEED_OUT set, then validate
    // the manifest against the drafted `provides` with the runner's own resolver.
    try {
      await runSeed({
        repoRoot,
        seed,
        env: seedEnv,
        timeoutMs: SEED_TIMEOUT_MS,
        ...(opts.signal ? { signal: opts.signal } : {}),
      })
    } catch (e) {
      if (e instanceof SeedError) return { ok: false, reason: e.message }
      throw e
    }

    // The server must still come up against the state the seed left behind — a seed
    // that wedges the datastore is worse than no seed at all.
    let probeNote = ''
    const boot = await preflightApiServer({
      resolvedServe: resolveEntry(repoRoot, server.serve),
      displayServe: server.serve,
      ...(server.cwd === 'repo' ? { cwd: repoRoot } : {}),
      recipeEnv: seedEnv,
      healthPath: server.healthPath,
      readyTimeoutMs: server.readyTimeoutMs,
      ...(opts.signal ? { signal: opts.signal } : {}),
      onReady: async (baseUrl: string) => {
        probeNote = await softProbe(baseUrl, opts.probePaths ?? [])
      },
    })
    if (!boot.ok) {
      return {
        ok: false,
        reason: `the server did not start after the seed ran: ${boot.stderr}`,
      }
    }
    if (probeNote) {
      // A SOFT signal only: recorded so a reader sees it, never a rejection. The
      // seeded ids are not in the URL, so a 4xx here says nothing about the seed.
      // eslint-disable-next-line no-console -- the drafting stage's one advisory line.
      console.warn(`[guard seed] ${probeNote}`)
    }
    return { ok: true }
  } finally {
    // A rejected draft leaves the tree BYTE-IDENTICAL — the script it wrote is the
    // only thing verification created. A fresh path is deleted; a path it was
    // REPLACING gets its exact prior bytes back.
    if (previousBytes !== null) fs.writeFileSync(target.abs, previousBytes)
    else if (fs.existsSync(target.abs)) fs.rmSync(target.abs)
    if (servicesUp && api.services?.down) {
      await runBuild(repoRoot, api.services.down, recipe.env, SEED_TIMEOUT_MS)
    }
  }
}

/** Probe one blocked flow's path for a 5xx — advisory text, or `''` when fine. */
async function softProbe(baseUrl: string, paths: readonly string[]): Promise<string> {
  const probePath = paths[0]
  if (!probePath) return ''
  try {
    const res = await fetch(new URL(probePath, baseUrl))
    return res.status >= 500 ? `${probePath} answered ${res.status} after seeding — the seed may not be enough` : ''
  } catch {
    return '' // an unreachable path is not a seed verdict; the boot already passed
  }
}

/**
 * The drafted `api.seed`, with the `script` field the fingerprint hashes. A drafted
 * `satisfies` is FILTERED against the schemes the corpus actually declares: an
 * unresolvable one is a hard `recipe-failed` stop at the next generate (item 56), so
 * a name the model invented is dropped here rather than committed.
 */
function toRecipeSeed(proposal: SeedProposal, knownSchemeNames: ReadonlySet<string>): RecipeApiSeed {
  const { credentials, fixtures } = proposal.seed.provides
  const cleaned = credentials
    ? Object.fromEntries(
        Object.entries(credentials).map(([name, cred]) => [
          name,
          cred.satisfies !== undefined && !knownSchemeNames.has(cred.satisfies)
            ? { header: cred.header, ...(cred.description ? { description: cred.description } : {}) }
            : cred,
        ]),
      )
    : undefined
  return {
    command: proposal.seed.command,
    script: proposal.scriptPath,
    provides: {
      ...(cleaned && Object.keys(cleaned).length > 0 ? { credentials: cleaned } : {}),
      ...(fixtures && Object.keys(fixtures).length > 0 ? { fixtures } : {}),
    },
  }
}

/** A repo-relative script path, refused when it escapes the repository. */
function resolveScriptPath(repoRoot: string, rel: string): { abs: string } | { reason: string } {
  if (path.isAbsolute(rel)) return { reason: `scriptPath must be repo-relative, got ${rel}` }
  const abs = path.resolve(repoRoot, rel)
  const root = path.resolve(repoRoot)
  if (!abs.startsWith(root + path.sep)) return { reason: `scriptPath escapes the repository: ${rel}` }
  return { abs }
}

function tail(output: string): string {
  return output.trimEnd().split('\n').slice(-5).join(' / ')
}

// ---------------------------------------------------------------------------
// The write — two artifacts, both reviewable
// ---------------------------------------------------------------------------

/**
 * Write the verified script and patch `api.seed` into recipe.json. The recipe is
 * parsed, patched, and re-serialized in ITS OWN format (2-space, the original's
 * trailing-newline presence) so the diff a reviewer reads is the seed block and
 * nothing else, and the WHOLE result is re-validated before it lands.
 */
function writeSeedArtifacts(
  repoRoot: string,
  proposal: SeedProposal,
  knownSchemeNames: ReadonlySet<string>,
): DraftSeedResult {
  const target = resolveScriptPath(repoRoot, proposal.scriptPath)
  if ('reason' in target) return { status: 'failed', reason: target.reason, proposal }
  const recipeFile = recipePath(repoRoot)
  const raw = fs.readFileSync(recipeFile, 'utf-8')
  let doc: Record<string, unknown>
  try {
    doc = JSON.parse(raw) as Record<string, unknown>
  } catch (e) {
    return { status: 'failed', reason: `recipe.json is not valid JSON: ${(e as Error).message}`, proposal }
  }
  const api = doc.api as Record<string, unknown> | undefined
  if (!api || typeof api !== 'object') {
    return { status: 'failed', reason: 'recipe.json has no `api` block', proposal }
  }
  const seed = toRecipeSeed(proposal, knownSchemeNames)
  api.seed = seed
  const validated = RecipeSchema.safeParse(doc)
  if (!validated.success) {
    return {
      status: 'failed',
      reason: `the resulting recipe.json would be invalid: ${validated.error.issues
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join('; ')}`,
      proposal,
    }
  }

  fs.mkdirSync(path.dirname(target.abs), { recursive: true })
  fs.writeFileSync(target.abs, proposal.scriptContent)
  fs.writeFileSync(recipeFile, JSON.stringify(doc, null, 2) + (raw.endsWith('\n') ? '\n' : ''))
  return {
    status: 'drafted',
    scriptPath: proposal.scriptPath,
    seed,
    recipePath: path.relative(repoRoot, recipeFile),
    fingerprint: computeRecipeFingerprint(repoRoot),
  }
}
