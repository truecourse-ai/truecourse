/**
 * THE SCOPE OF A REPAIR — what a session repairing a STANDING recipe is allowed
 * to change, and what its outcome did change.
 *
 * A repair session returns a FULL recipe, because it must hold the whole thing
 * to verify it boots. That makes the returned proposal a re-derivation unless
 * something checks: the engine diffs it against the recipe it was given and
 * holds it to the scope it was briefed with.
 *
 * - A NEEDS-driven repair is told exactly what the repository needs and the
 *   recipe does not provide, and may answer only with the world the app runs
 *   in: the env blocks, `api.services`, and the external declarations. What is
 *   installed, built, served and where was proved by a real boot, and a
 *   reworded version of it re-authors a customer's corpus for nothing.
 * - A BOOT-driven repair may change anything. The broken field cannot be known
 *   in advance, and refusing the true fix to protect a cache is backwards. When
 *   it moves a field a flow's key folds, the run says so.
 */

import { flowRecipeSliceFingerprint, type Recipe } from '@truecourse/guard-runner'
import { runnableDriverIds, type GuardDriverId } from '@truecourse/shared'
import type { RecipeProposal } from './schemas.js'

/**
 * The recipe fields a NEEDS-driven repair may change, as a reader (and the turn
 * back) names them. `api.externals` is in the list because declaring a third
 * party is an answer to a need; no proposal can carry one today, so the fold
 * preserves what is there and this entry never fires.
 */
export const NEEDS_REPAIR_FIELDS = [
  'env',
  'api.env',
  'api.servers.<name>.env',
  'web.env',
  'api.services',
  'api.externals',
] as const

/** The recipe's own `api.servers` map — what the fold hands back. */
type RecipeServers = NonNullable<NonNullable<Recipe['api']>['servers']>

/**
 * Fold a repair's proposal onto the recipe it repaired.
 *
 * Everything the proposal SCHEMA cannot express comes across from the standing
 * recipe untouched, so a repair can never drop a field by not having a word for
 * it: `api.seed`, `api.credentials` and `api.externals` (authored capability
 * declarations — credential names are safe from every repair), and the boot
 * tuning a proposal has no key for (`readyTimeoutMs`, a server's
 * `description`). A proposal that declares no `api` block at all takes them
 * with it, the same rule a re-derivation's block restore follows: there is no
 * api block left for them to live in.
 */
export function foldRepairedRecipe(before: Recipe, proposal: RecipeProposal): Recipe {
  const authored = before.api
  const api = proposal.api
    ? {
        ...proposal.api,
        ...(authored?.readyTimeoutMs !== undefined ? { readyTimeoutMs: authored.readyTimeoutMs } : {}),
        ...(proposal.api.servers ? { servers: keepServerTuning(authored?.servers, proposal.api.servers) } : {}),
        ...(authored?.seed !== undefined ? { seed: authored.seed } : {}),
        ...(authored?.credentials !== undefined ? { credentials: authored.credentials } : {}),
        ...(authored?.externals !== undefined ? { externals: authored.externals } : {}),
      }
    : undefined
  return {
    ...(proposal.install ? { install: proposal.install } : {}),
    build: proposal.build,
    ...(proposal.entry ? { entry: proposal.entry } : {}),
    ...(proposal.env ? { env: proposal.env } : {}),
    ...(api ? { api } : {}),
    ...(proposal.web ? { web: proposal.web } : {}),
    ...(proposal.preparations ? { preparations: proposal.preparations } : {}),
    ...(proposal.ownHosts ? { ownHosts: proposal.ownHosts } : {}),
  }
}

/** Each proposed server with the tuning the standing recipe gave a server of
 *  that name and no proposal can restate. A server the proposal invents has
 *  none to inherit. */
function keepServerTuning(
  before: RecipeServers | undefined,
  proposed: NonNullable<NonNullable<RecipeProposal['api']>['servers']>,
): RecipeServers {
  return Object.fromEntries(
    Object.entries(proposed).map(([name, server]) => {
      const prior = before?.[name]
      return [
        name,
        {
          ...server,
          ...(prior?.readyTimeoutMs !== undefined ? { readyTimeoutMs: prior.readyTimeoutMs } : {}),
          ...(prior?.description !== undefined ? { description: prior.description } : {}),
        },
      ]
    }),
  )
}

/**
 * The recipe fields that differ between two recipes, by the names above. A
 * field present on one side only counts as changed, so adding or dropping a
 * server, a web block or an install command is as visible as editing one.
 */
export function changedRecipeFields(before: Recipe, after: Recipe): string[] {
  const left = recipeSlots(before)
  const right = recipeSlots(after)
  const names = new Set([...left.keys(), ...right.keys()])
  return [...names].filter((name) => left.get(name) !== right.get(name)).sort()
}

/**
 * The changed fields a needs-driven repair is not allowed to have touched,
 * empty when the diff stays inside the scope. A per-server env change is named
 * against the pattern, not the server, so the list reads as the contract does.
 */
export function outOfScopeChanges(before: Recipe, after: Recipe): string[] {
  return changedRecipeFields(before, after).filter((field) => !withinNeedsScope(field))
}

function withinNeedsScope(field: string): boolean {
  if (field === 'env' || field === 'api.env' || field === 'web.env') return true
  if (field === 'api.services' || field === 'api.externals') return true
  return /^api\.servers\.[^.]+\.env$/.test(field)
}

/**
 * The turn back for an out-of-scope outcome, or `undefined` when the proposal
 * stays inside it. The session gets the field names it moved, since "something
 * else changed" is not something a session can act on.
 */
export function needsScopeRefusal(before: Recipe, after: Recipe): string | undefined {
  const outside = outOfScopeChanges(before, after)
  if (outside.length === 0) return undefined
  return (
    `Outcome refused: this repair answers named NEEDS, so it may change only the world the app runs in — ` +
    `${NEEDS_REPAIR_FIELDS.join(', ')}. Your proposal also changes ${outside.join(', ')}. ` +
    `Those fields were proved by a real install, build and boot, and rewording them re-authors every test written against them. ` +
    `Restore each one exactly as the recipe above has it and produce the outcome again.`
  )
}

/**
 * The surfaces whose flow recipe SLICE the repair moved — the part of the
 * recipe a committed flow's settle key folds. A boot repair is allowed to move
 * one, and every flow on that surface will re-author because of it, so the run
 * records which.
 */
export function movedFlowSlices(before: Recipe, after: Recipe): GuardDriverId[] {
  return runnableDriverIds.filter(
    (surface) => flowRecipeSliceFingerprint(before, surface) !== flowRecipeSliceFingerprint(after, surface),
  )
}

/**
 * ONE recipe as the comparable fields it carries. Deliberately a fixed list
 * rather than a deep walk: the scope is a promise about NAMED fields, and a
 * structural diff would report `api.services.up` where the contract says
 * `api.services`, leaving the turn back naming something the briefing never did.
 */
function recipeSlots(recipe: Recipe): Map<string, string> {
  const slots = new Map<string, string>()
  const put = (name: string, value: unknown): void => {
    if (value === undefined) return
    slots.set(name, JSON.stringify(value))
  }
  put('install', recipe.install)
  put('build', recipe.build)
  put('entry', recipe.entry)
  put('env', recipe.env)
  put('preparations', recipe.preparations)
  put('ownHosts', recipe.ownHosts)
  const api = recipe.api
  put('api', api ? 'declared' : undefined)
  if (api) {
    put('api.serve', api.serve)
    put('api.healthPath', api.healthPath)
    put('api.cwd', api.cwd)
    put('api.app', api.app)
    put('api.readyTimeoutMs', api.readyTimeoutMs)
    put('api.defaultServer', api.defaultServer)
    put('api.services', api.services)
    put('api.env', api.env)
    put('api.externals', api.externals)
    put('api.seed', api.seed)
    put('api.credentials', api.credentials)
    const servers = api.servers
    if (servers) {
      put('api.servers', Object.keys(servers).sort())
      for (const [name, server] of Object.entries(servers)) {
        put(`api.servers.${name}.serve`, server.serve)
        put(`api.servers.${name}.healthPath`, server.healthPath)
        put(`api.servers.${name}.cwd`, server.cwd)
        put(`api.servers.${name}.app`, server.app)
        put(`api.servers.${name}.readyTimeoutMs`, server.readyTimeoutMs)
        put(`api.servers.${name}.description`, server.description)
        put(`api.servers.${name}.env`, server.env)
      }
    }
  }
  const web = recipe.web
  put('web', web ? 'declared' : undefined)
  if (web) {
    put('web.build', web.build)
    put('web.serve', web.serve)
    put('web.cwd', web.cwd)
    put('web.healthPath', web.healthPath)
    put('web.readyTimeoutMs', web.readyTimeoutMs)
    put('web.app', web.app)
    put('web.env', web.env)
  }
  return slots
}
