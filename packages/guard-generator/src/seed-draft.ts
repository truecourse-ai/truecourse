/**
 * SEED GROUNDING + WRITE PATH — what remains of the one-shot seed draft after
 * the SEED SESSION (plan 03 step 13) took over the drafting itself.
 *
 * The draft used to be a single model call verified by the engine
 * (`draftSeed`, retired 2026-08-19). It is now `guard-setup.seed` — an agent
 * session in `@truecourse/core` (`services/guard-setup/seed-session.ts`) that
 * iterates against the LIVE services and proves its script by running it. What
 * this module keeps is everything that session and the engine still share:
 *
 *  - the GATE (`seedDraftGate`) — the cheap refusals, applied identically by
 *    the engine's seed step and by anything that wants to predict it;
 *  - the GROUNDING readers (`detectRoleColumns`, `connectionEnvVars`,
 *    `readExistingSeedScript`, `suggestedScriptPath`) — the deterministic
 *    inputs the briefing states;
 *  - the WRITE PATH (`toRecipeSeed`, `resolveScriptPath`,
 *    `writeSeedArtifacts`) — the two reviewable artifacts (the script file and
 *    the `api.seed` block), written only by the session's fold and only after
 *    its fresh-world proof passed. A drafted `satisfies` is filtered against
 *    the schemes the corpus actually declares before anything lands.
 *
 * ONE ARTIFACT COVERS DATA AND AUTH, still: `provides` emits both `fixtures`
 * (the rows) and `credentials` (the principals), because creating the test
 * principal IS data seeding — a login token cannot be minted without a user
 * row, and splitting them would put half the preparation behind the other half.
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  computeRecipeFingerprint,
  recipePath,
  RecipeSchema,
  type Recipe,
  type RecipeApiSeed,
} from '@truecourse/guard-runner'
import type { SeedProposal } from './schemas.js'
import type { SeedBlockedClaim } from './prompts.js'
import type { RecipeEcosystem } from './recipe-propose.js'

/** The session-outcome cache of the seed session (kept name — plan 03 step 13). */
export const SEED_CACHE_NAME = 'guard/seed'

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

/** What the write path reports. `skipped`/`failed` carry the honest reason. */
export type DraftSeedResult =
  /** A gate did not hold — nothing was called, nothing was written. */
  | { status: 'skipped'; reason: string }
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
 * The seed script this repo already has, when one is being REPLACED. Read so
 * the session improves on it rather than guessing afresh; absent (no seed, no
 * `script` field, an unreadable file) simply means there is nothing to improve on.
 */
export function readExistingSeedScript(
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
export function connectionEnvVars(recipe: Recipe): string[] {
  const names = new Set<string>([...Object.keys(recipe.env ?? {}), ...Object.keys(recipe.api?.env ?? {})])
  return [...names].filter((n) => /(?:DATABASE|DB|POSTGRES|MYSQL|MONGO|REDIS|SQLITE)/i.test(n)).sort()
}

/** Where a drafted script goes, in the repo's own conventions. A SUGGESTION — the
 *  fold names the real path, and an occupied path is refused at write time. */
export function suggestedScriptPath(ecosystem: RecipeEcosystem): string {
  if (ecosystem === 'python') return 'scripts/guard_seed.py'
  if (ecosystem === 'dotnet') return 'scripts/guard-seed.csx'
  return 'scripts/guard-seed.mjs'
}

/**
 * The drafted `api.seed`, with the `script` field the fingerprint hashes. A drafted
 * `satisfies` is FILTERED against the schemes the corpus actually declares: an
 * unresolvable one is a hard `recipe-failed` stop at the next generate, so
 * a name the model invented is dropped here rather than committed.
 */
export function toRecipeSeed(proposal: SeedProposal, knownSchemeNames: ReadonlySet<string>): RecipeApiSeed {
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
export function resolveScriptPath(repoRoot: string, rel: string): { abs: string } | { reason: string } {
  if (path.isAbsolute(rel)) return { reason: `scriptPath must be repo-relative, got ${rel}` }
  const abs = path.resolve(repoRoot, rel)
  const root = path.resolve(repoRoot)
  if (!abs.startsWith(root + path.sep)) return { reason: `scriptPath escapes the repository: ${rel}` }
  return { abs }
}

// ---------------------------------------------------------------------------
// The write — two artifacts, both reviewable
// ---------------------------------------------------------------------------

/**
 * Write the verified script and patch `api.seed` into recipe.json. The recipe is
 * parsed, patched, and re-serialized in ITS OWN format (2-space, the original's
 * trailing-newline presence) so the diff a reviewer reads is the seed block and
 * nothing else, and the WHOLE result is re-validated before it lands.
 *
 * The seed session's fold calls this AFTER its outcome settled and BEFORE the
 * fresh-world proof — a proof failure restores both files byte-for-byte (the
 * fold captures them first), so a refused draft leaves the tree exactly as it was.
 */
export function writeSeedArtifacts(
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
