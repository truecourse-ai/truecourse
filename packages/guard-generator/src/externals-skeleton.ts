/**
 * THE EXTERNALS DECLARATION SKELETON — the cheapest, highest-value thing setup does,
 * and the reason the whole stage exists.
 *
 * `computeRecipeFingerprint` folds `hashableRecipeText(raw)`: the DECLARATION (a
 * service's name, its `baseUrlEnv`, its extra `endpoints`, WHICH env vars it needs)
 * enters the digest; literal secret values are stripped and the gitignored
 * `scenarios/externals.local.json` overlay never reaches the function at all. So
 * declaring a service RE-AUTHORS the sections it used to block, while later supplying
 * the key for it is fingerprint-neutral.
 *
 * The consequence setup exploits: get EVERY detected service's declaration in BEFORE
 * the first generate — including the ones the user has no account for — and handing
 * guard a real API key afterwards causes ZERO re-authoring churn on already-good
 * sections. A declared-but-unprovided entry is a state authoring already treats
 * identically to undeclared (`resolveExternal` in guard-runner's `externals.ts`), so
 * the skeleton changes no verdict today; it only moves the fingerprint cost to the
 * cheapest possible moment.
 *
 * TWO RULES, both about never being confidently wrong:
 *  - NEVER INVENT A VARIABLE. `baseUrlEnv` is required by the schema and is injected
 *    into the app's env at every run; a service detection saw no base-URL override
 *    variable for is reported as UNDECLARABLE, not declared with a guess.
 *  - NEVER EDIT AN EXISTING DECLARATION. The skeleton only ever ADDS services. A
 *    service the user already declared (possibly by hand, possibly with values) is
 *    left byte-identical.
 *
 * Pure: this module derives the patch, the caller writes it.
 */

import type { DetectedExternalService } from '@truecourse/shared'
import type { Recipe, RecipeApiExternal } from '@truecourse/guard-runner'

/** The derived patch: what to add, and the honest account of what was not added. */
export interface ExternalsSkeleton {
  /** Service → the declaration to write into `api.externals`. Empty ⇒ no write. */
  declare: Record<string, RecipeApiExternal>
  /** Services already present in `api.externals` — untouched. */
  alreadyDeclared: string[]
  /** Detected services with no base-URL variable to point anywhere; never guessed. */
  undeclarable: string[]
}

/**
 * Derive the skeleton for `detected` against the recipe's current `api.externals`.
 *
 * Every detected base-URL override variable is used: the FIRST (best-confidence) one
 * becomes `baseUrlEnv`, and the rest become `endpoints` — the shape the runner's
 * external proxy consumes, because a vendor reached through several hosts has one
 * variable per host and the runner must know each is an ORIGIN (which it proxies),
 * not a key (which it forwards). An endpoint is only declared when detection also saw
 * the URL it falls back to today; the schema requires an absolute URL and there is
 * nothing honest to put there otherwise.
 *
 * No `baseUrl` is ever written: the account is the user's to supply, and a
 * declaration without one is exactly the "declared but not provided" state.
 */
export function deriveExternalsSkeleton(
  recipe: Recipe,
  detected: readonly DetectedExternalService[],
): ExternalsSkeleton {
  const existing = recipe.api?.externals ?? {}
  // One variable has exactly one owner (the recipe schema refuses otherwise), so a
  // variable an already-declared service claims must never be re-claimed here.
  const owned = new Set<string>()
  for (const external of Object.values(existing)) {
    owned.add(external.baseUrlEnv)
    for (const name of Object.keys(external.endpoints ?? {})) owned.add(name)
    for (const name of Object.keys(external.env ?? {})) owned.add(name)
  }

  const declare: Record<string, RecipeApiExternal> = {}
  const alreadyDeclared: string[] = []
  const undeclarable: string[] = []

  for (const service of [...detected].sort((a, b) => a.service.localeCompare(b.service))) {
    if (service.service in existing) {
      alreadyDeclared.push(service.service)
      continue
    }
    const vars = baseUrlVars(service).filter((v) => !owned.has(v.envVar))
    const [primary, ...extra] = vars
    if (!primary) {
      undeclarable.push(service.service)
      continue
    }
    const endpoints: Record<string, string> = {}
    for (const v of extra) {
      if (v.defaultUrl) endpoints[v.envVar] = v.defaultUrl
    }
    for (const v of vars) owned.add(v.envVar)
    declare[service.service] = {
      baseUrlEnv: primary.envVar,
      ...(Object.keys(endpoints).length > 0 ? { endpoints } : {}),
      description: describe(service),
    }
  }

  return { declare, alreadyDeclared, undeclarable }
}

/** Every base-URL override variable detection saw, best-confidence first, deduped. */
function baseUrlVars(service: DetectedExternalService): { envVar: string; defaultUrl?: string }[] {
  const out: { envVar: string; defaultUrl?: string }[] = []
  const seen = new Set<string>()
  for (const entry of service.baseUrlEnvs ?? []) {
    if (seen.has(entry.envVar)) continue
    seen.add(entry.envVar)
    out.push({ envVar: entry.envVar, ...(entry.defaultUrl ? { defaultUrl: entry.defaultUrl } : {}) })
  }
  // The back-compat scalar, when the richer list did not already carry it.
  if (service.baseUrlEnv && !seen.has(service.baseUrlEnv)) {
    out.push({ envVar: service.baseUrlEnv })
  }
  return out
}

/**
 * The declaration's `description`: what setup KNOWS, said plainly, so a reader of
 * `recipe.json` can tell an auto-declared skeleton from a hand-written account —
 * and so the "no account yet" state is written down rather than inferred from an
 * absent `baseUrl`.
 */
function describe(service: DetectedExternalService): string {
  const how = service.source === 'http' ? 'an HTTP call' : 'an SDK import'
  const kind = service.category ? `${service.category} service, ` : ''
  return `declared by \`truecourse guard setup\` — ${kind}detected from ${how}; no account provided yet`
}
