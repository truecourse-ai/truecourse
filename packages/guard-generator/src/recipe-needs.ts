/**
 * NEEDS VS PROVIDES — the deterministic detector that decides whether the recipe
 * still holds at this commit.
 *
 * The recipe is a human- or model-written declaration that was proved by really
 * building and booting the repository, so re-deriving it is a REWORDING, not a
 * correction. Nothing here is allowed to trigger one because a file moved: a
 * dependency bump, a reformatted lockfile and a renamed script all leave what
 * the application needs of its world exactly as it was. What DOES change it is
 * the application asking for something new — a datastore it did not talk to
 * before, a third party it did not call before.
 *
 * So: read the NEEDS off detection (which already runs, free, every setup),
 * read the PROVIDES off the recipe and the dependency catalog, and subtract.
 *
 * NARROW ON PURPOSE. Every entry here opens a paid repair session when it is
 * wrong, so a need is reported unprovided only when nothing in the recipe could
 * plausibly be answering it. The cost of the opposite mistake is one run of
 * `guard generate`, which installs, builds and boots the app and fails loudly.
 */

import fs from 'node:fs'
import crypto from 'node:crypto'
import { z } from 'zod'
import { loadDependencyCatalog, dependenciesPath, type Recipe } from '@truecourse/guard-runner'
import { DetectedExternalServiceSchema, DatastoreUrlRefSchema } from '@truecourse/shared'
import type { DatastoreUrlRef, DetectedExternalService, GuardDependencyClass } from '@truecourse/shared'

/**
 * What the detect step saw — the three reads the analysis pass already makes,
 * named as one value so the needs are derived from the same snapshot the setup
 * report records and the step spine keys on.
 */
export interface DetectedWorld {
  externalServices: readonly DetectedExternalService[]
  database: { type: string; driver: string } | null
  datastoreUrls: readonly DatastoreUrlRef[]
}

/**
 * ONE thing the repository's own code requires of the world a run boots.
 *
 * `id` is the need's identity across runs — it is what the needs digest folds,
 * so two setups over the same tree produce the same set whatever order the
 * analysis pass reported things in.
 */
export type RecipeNeed =
  /** A connection URL the source declares, with the variable that overrides it. */
  | { kind: 'datastore'; id: string; scheme: string; envVar?: string }
  /** The datastore the app's own driver binds (`prisma`/`postgres`). */
  | { kind: 'database'; id: string; type: string; driver: string }
  /** A third party the app calls, through an SDK or a bare HTTP request. */
  | { kind: 'third-party'; id: string; service: string; envVars: readonly string[] }

/** Where the answer to an unprovided need belongs. */
export type NeedAnswer =
  /** The recipe: a service to bring up, a variable to point at it. Scoped repair. */
  | 'recipe'
  /** A user registering an instance. No recipe changes, so no repair session. */
  | 'registration'

/** One need nothing provides, and what providing it would mean. */
export interface UnprovidedNeed {
  need: RecipeNeed
  /** What would provide it, in the words the repair briefing states. */
  provides: string
  answer: NeedAnswer
}

/** The whole comparison: the set, what is missing from it, and its identity. */
export interface RecipeNeedsDiff {
  needs: RecipeNeed[]
  unprovided: UnprovidedNeed[]
  /** sha256 over the need ids — the recipe step's one settle input. */
  fingerprint: string
}

/** The needs a diff hands to a repair session; the rest is somebody's to register. */
export function recipeNeedsOf(diff: RecipeNeedsDiff): UnprovidedNeed[] {
  return diff.unprovided.filter((entry) => entry.answer === 'recipe')
}

/**
 * THE NEEDS — what the repository declares it needs, read off detection alone.
 * Independent of the recipe by construction: a need is a fact about the code,
 * and comparing it with a recipe that changed would make the set move for the
 * recipe's reasons rather than the code's.
 *
 * What is NOT here: an env variable the code reads without a fallback. It
 * belongs (a variable with no default is a demand on the world), but no
 * per-file fact carries "this read had no fallback" today — the analyzer
 * harvests url-shaped env reads and the structural `X ?? 'https://…'` binding,
 * neither of which answers the question — so harvesting it means a new
 * extractor through the whole facts pipeline. Left out rather than guessed:
 * a name-shaped guess would report a defaulted variable as a need and buy a
 * repair session on a healthy recipe.
 */
export function recipeNeeds(world: DetectedWorld): RecipeNeed[] {
  const needs = new Map<string, RecipeNeed>()
  for (const ref of world.datastoreUrls) {
    const id = `datastore:${ref.scheme}:${ref.envVar ?? '-'}`
    needs.set(id, {
      kind: 'datastore',
      id,
      scheme: ref.scheme,
      ...(ref.envVar ? { envVar: ref.envVar } : {}),
    })
  }
  if (world.database) {
    const id = `database:${world.database.type}:${world.database.driver}`
    needs.set(id, { kind: 'database', id, type: world.database.type, driver: world.database.driver })
  }
  for (const service of world.externalServices) {
    const id = `third-party:${service.service}`
    needs.set(id, { kind: 'third-party', id, service: service.service, envVars: serviceVars(service) })
  }
  return [...needs.values()].sort((a, b) => a.id.localeCompare(b.id))
}

/** Every variable detection associates with one service, deduped and sorted. */
function serviceVars(service: DetectedExternalService): string[] {
  const names = new Set<string>([
    ...(service.baseUrlEnvs ?? []).map((entry) => entry.envVar),
    ...(service.baseUrlEnv ? [service.baseUrlEnv] : []),
    ...(service.credentialEnvs ?? []).map((entry) => entry.envVar),
  ])
  return [...names].sort()
}

/** The needs set's identity — the recipe step's settle input. */
export function needsFingerprint(needs: readonly RecipeNeed[]): string {
  return crypto
    .createHash('sha256')
    .update(needs.map((need) => need.id).join('\n'))
    .digest('hex')
}

/**
 * Compare what the tree needs with what the recipe (and the dependency catalog
 * beside it) provides.
 *
 * A repository with no recipe gets the needs and no verdict: there is nothing
 * to be unprovided by yet, and discovery is about to derive the whole thing.
 */
export function recipeNeedsDiff(args: {
  repoRoot: string
  recipe: Recipe | null
  world: DetectedWorld
}): RecipeNeedsDiff {
  const needs = recipeNeeds(args.world)
  const fingerprint = needsFingerprint(needs)
  if (!args.recipe) return { needs, unprovided: [], fingerprint }
  const provides = recipeProvides(args.repoRoot, args.recipe)
  const unprovided: UnprovidedNeed[] = []
  for (const need of needs) {
    const gap = unprovidedNeed(need, provides)
    if (gap) unprovided.push(gap)
  }
  return { needs, unprovided, fingerprint }
}

/** What the recipe and the catalog beside it stand behind. */
interface RecipeProvides {
  /** Every variable the recipe sets or names, anywhere in it. */
  envVars: ReadonlySet<string>
  /** True when the recipe declares a datastore bring-up of its own. */
  services: boolean
  /** Services declared under `api.externals`. */
  externals: ReadonlySet<string>
  /** Detected service → the class the catalog filed it under. */
  catalogued: ReadonlyMap<string, GuardDependencyClass>
}

/**
 * What the recipe provides, plus the catalog's word on each third party.
 *
 * A catalog that does not parse contributes nothing rather than throwing: it is
 * the catalog step's business to report, and reading it as empty only ever
 * makes a third party look like one nobody has classified yet — which sends it
 * to a registration prompt, never to a repair session.
 */
function recipeProvides(repoRoot: string, recipe: Recipe): RecipeProvides {
  const envVars = new Set<string>([
    ...Object.keys(recipe.env ?? {}),
    ...Object.keys(recipe.api?.env ?? {}),
    ...Object.values(recipe.api?.servers ?? {}).flatMap((server) => Object.keys(server.env ?? {})),
    ...Object.keys(recipe.web?.env ?? {}),
  ])
  for (const external of Object.values(recipe.api?.externals ?? {})) {
    envVars.add(external.baseUrlEnv)
    for (const name of Object.keys(external.endpoints ?? {})) envVars.add(name)
    for (const name of Object.keys(external.env ?? {})) envVars.add(name)
  }
  const catalogued = new Map<string, GuardDependencyClass>()
  if (fs.existsSync(dependenciesPath(repoRoot))) {
    try {
      for (const entry of loadDependencyCatalog(repoRoot).dependencies) {
        for (const service of entry.services ?? []) catalogued.set(service, entry.class)
      }
    } catch {
      // An unreadable catalog names no service; the catalog step reports it.
    }
  }
  return {
    envVars,
    services: recipe.api?.services !== undefined,
    externals: new Set(Object.keys(recipe.api?.externals ?? {})),
    catalogued,
  }
}

/** Datastores that need no daemon: the file IS the database. */
const EMBEDDED_DATASTORES = new Set(['sqlite', 'sqlite3', 'file', 'duckdb'])

/**
 * One need against the provides, or `undefined` when something answers it.
 *
 * The datastore rules are the narrow ones. A recipe that declares `api.services`
 * stands SOME world up, and which container inside it answers which scheme is
 * not knowable from the recipe text, so a second datastore added to a repo that
 * already brings one up is deliberately not reported here — the build-and-boot
 * a run makes is what catches that, and guessing from image names would report
 * healthy recipes as broken.
 */
function unprovidedNeed(need: RecipeNeed, provides: RecipeProvides): UnprovidedNeed | undefined {
  switch (need.kind) {
    case 'datastore': {
      if (provides.services) return undefined
      if (need.envVar && provides.envVars.has(need.envVar)) return undefined
      return {
        need,
        provides: need.envVar
          ? `an \`api.services\` bring-up for the ${need.scheme} datastore, with \`${need.envVar}\` in the recipe's env pointing the app at it`
          : `an \`api.services\` bring-up for the ${need.scheme} datastore`,
        answer: 'recipe',
      }
    }
    case 'database': {
      if (provides.services || EMBEDDED_DATASTORES.has(need.type.toLowerCase())) return undefined
      return {
        need,
        provides: `an \`api.services\` bring-up for the ${need.type} the app binds through ${need.driver}, and the schema step that fills it`,
        answer: 'recipe',
      }
    }
    case 'third-party': {
      if (provides.externals.has(need.service)) return undefined
      if (need.envVars.some((name) => provides.envVars.has(name))) return undefined
      const filed = provides.catalogued.get(need.service)
      // The catalog's CLASS is what says whether a third party can be stood up
      // locally. `supplied` is a real-world account nobody may fabricate: it is
      // answered by a registration the catalog step tracks and reports as
      // "awaiting an account" (this detector never reads the registrations),
      // so as far as the RECIPE is concerned it is provided. The other two
      // classes are state the engine itself creates or seeds, which a compose
      // service can stand in for — and standing one up is a recipe edit.
      if (filed === 'supplied') return undefined
      if (filed === undefined) {
        return {
          need,
          provides: `an account registered for \`${need.service}\`, or a catalog entry classifying it`,
          answer: 'registration',
        }
      }
      if (provides.services) return undefined
      return {
        need,
        provides: `an \`api.services\` bring-up standing \`${need.service}\` in locally (the catalog files it as ${filed}, which the engine materializes rather than the user registering it)`,
        answer: 'recipe',
      }
    }
  }
}

/**
 * The detection snapshot as the setup report writes it, read back. The step
 * spine's components are computed off this string, so the needs the gate
 * compares are the needs of the snapshot that was recorded, not of a second
 * analysis pass. An unreadable snapshot names no need at all — which settles
 * nothing and re-opens nothing, since both sides read it the same way.
 */
export function parseDetectionSnapshot(json: string): DetectedWorld {
  if (json === '') return EMPTY_WORLD
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return EMPTY_WORLD
  }
  const shape = DetectionSnapshotSchema.safeParse(parsed)
  if (!shape.success) return EMPTY_WORLD
  return {
    externalServices: shape.data.externalServices,
    database: shape.data.database,
    datastoreUrls: shape.data.datastoreUrls,
  }
}

const EMPTY_WORLD: DetectedWorld = { externalServices: [], database: null, datastoreUrls: [] }

const DetectionSnapshotSchema = z.object({
  externalServices: z.array(DetectedExternalServiceSchema).default([]),
  database: z.object({ type: z.string(), driver: z.string() }).passthrough().nullable().default(null),
  datastoreUrls: z.array(DatastoreUrlRefSchema).default([]),
})
