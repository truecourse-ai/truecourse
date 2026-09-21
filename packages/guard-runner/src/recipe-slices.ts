/**
 * THE RECIPE, SLICED PER CONSUMER.
 *
 * `computeRecipeFingerprint` is one digest over every recipe-class input the
 * repository carries — the ecosystem manifests, the recipe file, the preparation
 * scripts, the seed script, the dependency catalog. Folding it into a key says
 * "some recipe input moved", which is almost never a reason for THAT key's
 * consumer to re-run: a dependency bump moved it, and a committed flow that
 * never read a dependency version re-authored anyway.
 *
 * Each slice below is the part of the recipe ONE consumer's output can depend
 * on, and nothing else. A slice that does not move is a consumer that does not
 * re-run. The rule for what may enter a slice at all:
 *
 * - Never a secret. Inline credential values and external keys are stripped
 *   before anything here reads the recipe; only names, headers and env VAR
 *   names ever reach a digest.
 * - Never model-written prose. A credential's role `description` and a
 *   dependency's `summary` are rewordings of the same fact.
 * - Never the world's shape. Services, install and build commands, the env the
 *   app reads and the external accounts decide whether the app BOOTS, which
 *   every run verifies by booting it. None of it reaches a flow's key.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { GuardDriverId, GuardScenario } from '@truecourse/shared'
import { placeholderNames } from './api/vars.js'
import {
  hashableRecipeText,
  resolveApiServers,
  resolvePreparationScripts,
  type Recipe,
} from './recipe.js'
import { dependenciesPath, recipePath } from './store.js'

/** One slice's digest: a labelled, canonically-ordered material, hashed. */
function digest(material: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(material)).digest('hex')
}

/** The recipe's raw text, or `null` when the repository has none. */
function readRecipeText(repoRoot: string): string | null {
  const file = recipePath(repoRoot)
  try {
    return fs.statSync(file).isFile() ? fs.readFileSync(file, 'utf-8') : null
  } catch {
    return null
  }
}

/**
 * THE RECIPE CONTRACT — the canonical, secret-stripped `recipe.json` plus the
 * bytes of every preparation script it names. It is the recipe as a PROMISE
 * about the repository: what boots, how it is prepared, which capabilities
 * exist. The steps that read the whole promise key on this — interface
 * derivation, the reconcile session, the seed step — so that a dependency bump
 * or a catalog edit, neither of which changes the promise, re-runs none of them.
 */
export function recipeContractFingerprint(repoRoot: string): string {
  const raw = readRecipeText(repoRoot)
  if (raw === null) return digest({ recipe: null })
  const scripts = resolvePreparationScripts(repoRoot, raw).map((abs) => [
    path.relative(repoRoot, abs),
    crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex'),
  ])
  return digest({ recipe: hashableRecipeText(raw), scripts })
}

/**
 * The part of the recipe ONE SURFACE's scenarios are written against:
 *
 * - `api` — the servers a scenario may bind (name, health path, the workspace
 *   app each one serves), which one it gets when it names none, and the
 *   declared credentials as CAPABILITIES (name, header, the scheme they
 *   satisfy, the servers they are allowed on, and where the value comes from:
 *   an env var NAME, or the login call that mints it).
 * - `cli` — the entry argv, which is the program a scenario invokes.
 * - `web` — the web block minus its `env`: what is served and how readiness is
 *   observed. The env configures the app, not what the scenario drives.
 *
 * Everything else in the recipe is the world the run boots, so it reaches no
 * flow's key. A flow on a surface the recipe does not declare gets the empty
 * slice, which is stable — a cli flow is not re-authored by an api edit.
 */
export function flowRecipeSliceFingerprint(recipe: Recipe | null, surface: GuardDriverId): string {
  if (!recipe) return digest({ surface, recipe: null })
  switch (surface) {
    case 'api': {
      const api = recipe.api
      if (!api) return digest({ surface })
      const { servers, defaultServer } = resolveApiServers(recipe)
      return digest({
        surface,
        defaultServer,
        servers: [...servers.values()]
          .map((s) => ({ name: s.name, healthPath: s.healthPath, app: s.app ?? null }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        credentials: Object.entries(api.credentials ?? {})
          .map(([name, cred]) => ({
            name,
            header: cred.header,
            satisfies: cred.satisfies ?? null,
            servers: cred.servers ? [...cred.servers].sort() : null,
            // The SOURCE as a capability: which env var holds it, or which call
            // mints it. Never the value, and never the login body.
            fromEnv: cred.valueFromEnv ?? null,
            login: cred.fromRequest
              ? {
                  method: cred.fromRequest.method,
                  path: cred.fromRequest.path,
                  server: cred.fromRequest.server ?? null,
                }
              : null,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      })
    }
    case 'cli':
      return digest({ surface, entry: recipe.entry ?? null })
    case 'web': {
      const web = recipe.web
      return digest({
        surface,
        web: web
          ? {
              build: web.build ?? null,
              serve: web.serve,
              cwd: web.cwd ?? null,
              healthPath: web.healthPath ?? null,
              readyTimeoutMs: web.readyTimeoutMs ?? null,
              app: web.app ?? null,
            }
          : null,
      })
    }
    default:
      return digest({ surface })
  }
}

/** One roster entry as a key folds it: the declaration, never its prose. */
interface RosterView {
  fixtures: [string, string[]][]
  credentials: [string, { header: string; satisfies: string | null; servers: string[] | null }][]
}

/** `api.seed.provides` with the role descriptions dropped and the rest sorted. */
function rosterView(recipe: Recipe | null): RosterView {
  const provides = recipe?.api?.seed?.provides
  return {
    fixtures: Object.entries(provides?.fixtures ?? {})
      .map(([name, fields]): [string, string[]] => [name, [...fields].sort()])
      .sort(([a], [b]) => a.localeCompare(b)),
    credentials: Object.entries(provides?.credentials ?? {})
      .map(([name, cred]): RosterView['credentials'][number] => [
        name,
        {
          header: cred.header,
          satisfies: cred.satisfies ?? null,
          servers: cred.servers ? [...cred.servers].sort() : null,
        },
      ])
      .sort(([a], [b]) => a.localeCompare(b)),
  }
}

/**
 * THE WHOLE ROSTER — every fixture the seed emits with its field names, and
 * every credential it mints with its header and the scheme it satisfies. It is
 * exactly what an authoring session is told the seeded world offers, so a
 * session that has not run yet keys on all of it. A seed script rewritten to
 * produce the same roster moves nothing; a renamed fixture moves everything
 * that could have used it.
 */
export function seedRosterFingerprint(recipe: Recipe | null): string {
  return digest(rosterView(recipe))
}

/** Every `{{fixture:…}}` and `{{cred:…}}` name a committed scenario references. */
function referencedNames(scenarios: readonly GuardScenario[]): {
  fixtures: string[]
  credentials: string[]
} {
  const fixtures = new Set<string>()
  const credentials = new Set<string>()
  for (const scenario of scenarios) {
    const names = placeholderNames(JSON.stringify(scenario))
    // A fixture reference is `<name>.<field>`; the roster is keyed by the name.
    for (const ref of names.fixtures) fixtures.add(ref.split('.')[0])
    for (const name of names.credentials) credentials.add(name)
  }
  return { fixtures: [...fixtures].sort(), credentials: [...credentials].sort() }
}

/**
 * THE ROSTER THIS FLOW USES — the roster entries its committed scenarios name,
 * each with its declaration. A flow that reads `{{fixture:org.id}}` re-authors
 * when `org` loses that field or vanishes from the seed; a flow that never
 * names it does not. A name the roster does not declare is folded as absent, so
 * a fixture moving into or out of the seed still moves the flows that use it.
 *
 * Computed off the committed scenarios, so an old manifest gets this component
 * without having recorded anything.
 */
export function flowRosterFingerprint(
  recipe: Recipe | null,
  scenarios: readonly GuardScenario[],
): string {
  const roster = rosterView(recipe)
  const fixtures = new Map(roster.fixtures)
  const credentials = new Map(roster.credentials)
  const used = referencedNames(scenarios)
  return digest({
    fixtures: used.fixtures.map((name) => [name, fixtures.get(name) ?? null]),
    credentials: used.credentials.map((name) => [name, credentials.get(name) ?? null]),
  })
}

/** One preparation profile as a key folds it: its declaration plus its scripts. */
function preparationView(repoRoot: string, recipe: Recipe | null, name: string): unknown {
  const profile = recipe?.preparations?.[name]
  if (!profile) return null
  const script = (rel: string | undefined): string | null => {
    if (!rel) return null
    const abs = path.resolve(repoRoot, rel)
    try {
      return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex')
    } catch {
      return 'missing'
    }
  }
  return {
    profile,
    scripts: {
      seed: script(profile.seed?.script),
      verify: script(profile.verify?.script),
      cleanup: script(profile.cleanup?.script),
    },
  }
}

/**
 * THE PREPARATION THIS FLOW RUNS ON — the profiles its committed scenarios name
 * in `setup.preparation`, each with its declaration and the bytes of its seed,
 * verification and cleanup scripts. Editing a profile re-authors the flows
 * prepared by it and no others.
 */
export function flowPreparationFingerprint(
  repoRoot: string,
  recipe: Recipe | null,
  scenarios: readonly GuardScenario[],
): string {
  const names = [
    ...new Set(scenarios.flatMap((s) => (s.setup?.preparation ? [s.setup.preparation] : []))),
  ].sort()
  return digest(names.map((name) => [name, preparationView(repoRoot, recipe, name)]))
}

/**
 * EVERY DECLARED PREPARATION, with its scripts. The authoring session picks its
 * own profile from the catalog it is offered, so a key computed BEFORE the
 * session cannot know which one it will choose and folds the whole offer.
 */
export function preparationsFingerprint(repoRoot: string, recipe: Recipe | null): string {
  const names = Object.keys(recipe?.preparations ?? {}).sort()
  return digest(names.map((name) => [name, preparationView(repoRoot, recipe, name)]))
}

/**
 * THE CATALOG'S IDENTITY — the dependency names and classes `dependencies.json`
 * declares, sorted. Which classes of starting state exist, not how any of them
 * is described: the catalog session rewrites its own summaries and
 * registrations, and re-running the seed step over a reworded catalog buys
 * nothing. A catalog that gains or loses an entry, or reclassifies one, moves
 * it. A repository with no catalog folds the empty list.
 */
export function dependencyCatalogIdentity(repoRoot: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(dependenciesPath(repoRoot), 'utf-8'))
  } catch {
    return digest([])
  }
  const shape = CatalogIdentitySchema.safeParse(parsed)
  if (!shape.success) return digest([])
  return digest(
    shape.data.dependencies
      .map((entry) => [entry.name, entry.class])
      .sort(([a], [b]) => a.localeCompare(b)),
  )
}

/** The identity read is tolerant on purpose: a catalog shape it cannot read
 *  names no dependency, which is what an absent catalog folds too. */
const CatalogIdentitySchema = z.object({
  dependencies: z.array(z.object({ name: z.string(), class: z.string() }).passthrough()),
})
