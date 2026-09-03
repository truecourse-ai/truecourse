/**
 * EXTERNAL API ACCOUNTS — the user-provided half of the third-party story. The
 * service detector NAMES the third parties a repo depends on and `setup.http` lets
 * a scenario STUB one; this layer lets the user hand guard a REAL or SANDBOX
 * account for a service so flows can be authored against it live instead of
 * settling `blocked-on`.
 *
 * Two files, one merged view:
 *   `.truecourse/scenarios/recipe.json`         → `api.externals` (COMMITTED — the
 *      declaration: which services exist, which env var carries each base URL, which
 *      extra env vars the app needs. It is in the recipe, so it enters the recipe
 *      fingerprint and declaring a service RE-AUTHORS the sections it used to block:
 *      the self-unblocking mechanism.)
 *   `.truecourse/scenarios/externals.local.json` → the GITIGNORED overlay (the
 *      SECRETS and the per-developer URLs: `{ "<service>": { baseUrl?, env? } }`,
 *      merged over the recipe per FIELD, local wins). It is never hashed, so a
 *      rotated key or a new sandbox URL never re-authors anything.
 *
 * The one distinction everything downstream reads is PROVIDED vs INCOMPLETE vs
 * UNPROVIDED, and it is computed in exactly one place: {@link resolveExternal}.
 */

import fs from 'node:fs'
import { z } from 'zod'
import { RecipeError, type RecipeApiExternal } from './recipe.js'
import { externalsLocalPath } from './store.js'

/**
 * The gitignored overlay's shape: service → the values the committed recipe must
 * not carry. `env` is a bare `name → value` map (no `valueFromEnv` — this file IS
 * the value store), and only names the recipe DECLARES are honored, so the overlay
 * can never introduce a capability teammates cannot see.
 */
export const ExternalsLocalFileSchema = z.record(
  z.string().min(1),
  z
    .object({
      baseUrl: z
        .string()
        .regex(/^https?:\/\/\S+$/, 'baseUrl must be an absolute http(s) URL')
        .optional(),
      /**
       * Per-developer overrides for the service's EXTRA base-URL variables, env
       * var → origin. Merged per key over the recipe's `endpoints`; a key the
       * recipe never declares is dropped and surfaced, exactly like `env`.
       */
      endpoints: z
        .record(
          z.string().min(1),
          z.string().regex(/^https?:\/\/\S+$/, 'an endpoint must be an absolute http(s) URL'),
        )
        .optional(),
      env: z.record(z.string().min(1), z.string()).optional(),
      /**
       * The authorization token this machine reaches the service with. It lives HERE
       * and nowhere else: a token is a secret, so the committed declaration must
       * never carry one, and it is outside every fingerprint, so rotating it
       * re-authors nothing.
       */
      token: z.string().optional(),
      /**
       * Extra request headers this machine reaches the service with (a tenant id, an
       * account header, a second key). Local for the same reason `token` is: the
       * declaration says WHICH services exist, this file says how one developer's
       * account is addressed.
       */
      headers: z.record(z.string().min(1), z.string()).optional(),
    })
    .strict(),
)
export type ExternalsLocalFile = z.infer<typeof ExternalsLocalFileSchema>

/** One external's declaration joined with whatever the local overlay supplied. */
export interface MergedExternal {
  service: string
  baseUrlEnv: string
  baseUrl?: string
  /** Where `baseUrl` came from; absent when there is none. */
  baseUrlSource?: 'recipe' | 'local'
  mode?: 'sandbox' | 'real'
  description?: string
  /**
   * EXTRA base-URL variables of this service, in declaration order, with
   * the overlay applied. The PRIMARY (`baseUrlEnv`/`baseUrl`) is not repeated here.
   */
  endpoints: MergedExternalEndpoint[]
  /** Declared env vars, in declaration order, with the local overlay applied. */
  env: MergedExternalEnv[]
  /**
   * The overlay's authorization token, when it carries one. Overlay-only by
   * construction (the declaration cannot hold a secret), so there is nothing to
   * merge — it is passed through so a surface can say an account is registered
   * without ever reading the file itself.
   */
  token?: string
  /** The overlay's extra request headers, name → value. Overlay-only, like `token`. */
  headers: Record<string, string>
  /** Overlay keys under this service that the recipe never declared (ignored). */
  undeclaredLocalEnv: string[]
}

/** One extra base-URL variable of an external, after the overlay is applied. */
export interface MergedExternalEndpoint {
  /** The env var THE APP reads this origin from. */
  envVar: string
  /** The origin it points at. */
  url: string
  /** Where `url` came from. */
  source: 'recipe' | 'local'
}

/** One declared env var of an external, plus the overlay value when there is one. */
export interface MergedExternalEnv {
  name: string
  /** Inline recipe value (discouraged for secrets). */
  value?: string
  /** Host env-var name the value is read from. */
  valueFromEnv?: string
  /** The overlay's value, which beats both of the above. */
  localValue?: string
}

/** Whether the app can actually reach this service on this machine, right now. */
export type ExternalState = 'provided' | 'incomplete' | 'unprovided'

/** One requirement of an external and whether it is satisfied — the UI's granularity. */
export interface ExternalRequirement {
  /** `base-url` is the `baseUrlEnv` assignment; `env` is one declared extra var. */
  kind: 'base-url' | 'env'
  /** The env var this requirement sets on the server. */
  envVar: string
  resolved: boolean
  /** Where the value came from (absent when unresolved). */
  source?: 'recipe' | 'local' | 'process-env'
  /** Why it is unresolved (absent when resolved) — rendered verbatim by the UIs. */
  reason?: string
  /** True when the value is a secret (an env value), so no UI ever echoes it. */
  secret: boolean
  /**
   * True when this requirement's value came out of the DECLARATION rather than from
   * the user: an extra base-URL variable whose origin `guard setup` copied
   * out of the codebase. It is listed like any other requirement, but it expresses no
   * intent to reach the service, so {@link resolveExternal} excludes it from the
   * state decision — see the comment there.
   */
  derived?: boolean
}

/** One external, resolved against a concrete process env. */
export interface ResolvedExternal {
  service: string
  state: ExternalState
  baseUrlEnv: string
  baseUrl?: string
  mode?: 'sandbox' | 'real'
  description?: string
  requirements: ExternalRequirement[]
  /**
   * Every BASE-URL variable of this service and the origin behind it — the primary
   * first, then the declared `endpoints`. This is what the run-time proxy
   * layer binds: one loopback proxy per entry, all sharing the service's fault
   * script and call log. Empty unless the service is `provided`.
   */
  endpoints: { envVar: string; url: string }[]
  /** `envVar → value` the runner injects into the SERVER env (provided only). */
  inject: Record<string, string>
  /** The SECRET values among `inject` (never the base URL) — fed to the redactor. */
  secrets: { label: string; value: string }[]
}

/** The local overlay is present but not a valid overlay file. */
export class ExternalsError extends RecipeError {}

/**
 * Read + validate `externals.local.json`, or `{}` when it does not exist. A file
 * that exists but does not parse is a LOUD error, not an empty overlay: silently
 * ignoring it would boot the app against the wrong (or no) account and blame the
 * app for the failures.
 */
export function loadExternalsLocal(repoRoot: string): ExternalsLocalFile {
  const file = externalsLocalPath(repoRoot)
  if (!fs.existsSync(file)) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch (e) {
    throw new ExternalsError(
      `externals.local.json is not valid JSON: ${e instanceof Error ? e.message : e}`,
    )
  }
  const result = ExternalsLocalFileSchema.safeParse(parsed)
  if (!result.success) {
    throw new ExternalsError(
      `externals.local.json is invalid: ${result.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
    )
  }
  return result.data
}

/**
 * Join the committed declarations with the local overlay, per field. Overlay
 * entries for a service the recipe never declares are DROPPED — the declaration is
 * the committed half by design, so a local-only service could never unblock
 * authoring for anyone else, and honoring it here would make one developer's run
 * disagree with the corpus. The same rule applies one level down: an overlay env
 * key the recipe does not declare is recorded in `undeclaredLocalEnv` (so a UI can
 * say so) and never injected.
 */
export function mergeExternals(
  declared: Record<string, RecipeApiExternal> | undefined,
  local: ExternalsLocalFile,
): MergedExternal[] {
  return Object.entries(declared ?? {}).map(([service, external]) => {
    const overlay = local[service]
    const declaredEnv = Object.entries(external.env ?? {})
    const declaredNames = new Set(declaredEnv.map(([name]) => name))
    const declaredEndpoints = Object.entries(external.endpoints ?? {})
    const declaredEndpointNames = new Set(declaredEndpoints.map(([name]) => name))
    return {
      service,
      baseUrlEnv: external.baseUrlEnv,
      ...(overlay?.baseUrl !== undefined
        ? { baseUrl: overlay.baseUrl, baseUrlSource: 'local' as const }
        : external.baseUrl !== undefined
          ? { baseUrl: external.baseUrl, baseUrlSource: 'recipe' as const }
          : {}),
      ...(external.mode ? { mode: external.mode } : {}),
      ...(external.description ? { description: external.description } : {}),
      endpoints: declaredEndpoints.map(([envVar, url]) => {
        const localUrl = overlay?.endpoints?.[envVar]
        return localUrl !== undefined
          ? { envVar, url: localUrl, source: 'local' as const }
          : { envVar, url, source: 'recipe' as const }
      }),
      env: declaredEnv.map(([name, source]) => ({
        name,
        ...(source.value !== undefined ? { value: source.value } : {}),
        ...(source.valueFromEnv !== undefined ? { valueFromEnv: source.valueFromEnv } : {}),
        ...(overlay?.env?.[name] !== undefined ? { localValue: overlay.env[name] } : {}),
      })),
      ...(overlay?.token !== undefined ? { token: overlay.token } : {}),
      headers: { ...(overlay?.headers ?? {}) },
      undeclaredLocalEnv: [
        ...Object.keys(overlay?.env ?? {}).filter((name) => !declaredNames.has(name)),
        ...Object.keys(overlay?.endpoints ?? {}).filter((name) => !declaredEndpointNames.has(name)),
      ].sort(),
    }
  })
}

/**
 * The SINGLE definition of "provided": a base URL is known AND every declared env
 * var resolves. Nothing the USER supplied resolves ⇒ `unprovided` (the service was
 * declared so the UI can offer to fill it in; authoring keeps treating it as a
 * blocker, exactly as before this feature). SOME of it resolves ⇒ `incomplete` — a
 * half-configured account is the dangerous state (an API key set with no base URL
 * would send the key to the service's PRODUCTION default), so the runner hard-stops
 * on it rather than running against a world nobody described.
 *
 * The state follows USER INTENT, not a requirement tally. Only requirements a human
 * could have supplied — the primary base URL (recipe-inline or overlay), an overlay
 * `endpoints` entry, an env var's inline `value`/`valueFromEnv`/overlay value — vote.
 * A DERIVED requirement (an extra base-URL variable whose origin `guard setup` copied
 * out of the codebase) is a fact about the repo, not a request to reach the vendor, so
 * it is listed but never voted. Counting it made a skeleton service with TWO base-URL
 * variables resolve `incomplete` — one auto-resolved requirement out of two — and hard
 * -stop every run, while the identical service with ONE variable read `unprovided` and
 * was correctly ignored. A service must not be penalized for having two hosts.
 *
 * The safety property survives: a user who ASKED for this service (a key, a sandbox
 * base URL) and cannot be fully honored still gets `incomplete` and the hard stop,
 * because every one of those inputs votes.
 *
 * A resolved env value is a SECRET (it is an API key by construction); the base URL
 * is not, and is shown freely by every surface.
 */
export function resolveExternal(
  merged: MergedExternal,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedExternal {
  const requirements: ExternalRequirement[] = []
  const inject: Record<string, string> = {}
  const secrets: { label: string; value: string }[] = []

  requirements.push(
    merged.baseUrl !== undefined
      ? {
          kind: 'base-url',
          envVar: merged.baseUrlEnv,
          resolved: true,
          source: merged.baseUrlSource ?? 'recipe',
          secret: false,
        }
      : {
          kind: 'base-url',
          envVar: merged.baseUrlEnv,
          resolved: false,
          reason: 'no base URL provided — add one to api.externals or externals.local.json',
          secret: false,
        },
  )
  if (merged.baseUrl !== undefined) inject[merged.baseUrlEnv] = merged.baseUrl

  // An EXTRA base-URL variable carries its origin in the declaration (or
  // the overlay), so it always resolves — it is a requirement so the UIs list it and
  // so a service whose second host is missing entirely reads as what it is. A
  // recipe-sourced one is DERIVED (detection wrote it); an overlay one is the user
  // pointing this host somewhere, which is intent and therefore votes.
  for (const endpoint of merged.endpoints) {
    requirements.push({
      kind: 'base-url',
      envVar: endpoint.envVar,
      resolved: true,
      source: endpoint.source,
      secret: false,
      ...(endpoint.source === 'recipe' ? { derived: true } : {}),
    })
    inject[endpoint.envVar] = endpoint.url
  }

  for (const item of merged.env) {
    const resolved = resolveEnvItem(item, env)
    requirements.push({ kind: 'env', envVar: item.name, secret: true, ...resolved.requirement })
    if ('value' in resolved) {
      inject[item.name] = resolved.value
      secrets.push({ label: `${merged.service}.${item.name}`, value: resolved.value })
    }
  }

  const voting = requirements.filter((r) => !r.derived)
  const satisfied = voting.filter((r) => r.resolved).length
  const state: ExternalState =
    satisfied === voting.length ? 'provided' : satisfied === 0 ? 'unprovided' : 'incomplete'

  return {
    service: merged.service,
    state,
    baseUrlEnv: merged.baseUrlEnv,
    ...(merged.baseUrl !== undefined ? { baseUrl: merged.baseUrl } : {}),
    ...(merged.mode ? { mode: merged.mode } : {}),
    ...(merged.description ? { description: merged.description } : {}),
    requirements,
    endpoints:
      state === 'provided'
        ? [
            ...(merged.baseUrl !== undefined
              ? [{ envVar: merged.baseUrlEnv, url: merged.baseUrl }]
              : []),
            ...merged.endpoints.map((e) => ({ envVar: e.envVar, url: e.url })),
          ]
        : [],
    // Only a fully PROVIDED service configures the app: injecting half an account
    // is what `incomplete` exists to refuse.
    inject: state === 'provided' ? inject : {},
    secrets: state === 'provided' ? secrets : [],
  }
}

/** Resolve one declared env var: local overlay > inline value > host env var. */
function resolveEnvItem(
  item: MergedExternalEnv,
  env: NodeJS.ProcessEnv,
): { value: string; requirement: Pick<ExternalRequirement, 'resolved' | 'source'> } | { requirement: Pick<ExternalRequirement, 'resolved' | 'reason'> } {
  if (item.localValue !== undefined && item.localValue.trim() !== '') {
    return { value: item.localValue, requirement: { resolved: true, source: 'local' } }
  }
  if (item.value !== undefined) {
    return { value: item.value, requirement: { resolved: true, source: 'recipe' } }
  }
  if (item.valueFromEnv !== undefined) {
    const fromEnv = env[item.valueFromEnv]
    // Unset OR set-but-blank both count as unresolved, mirroring the credential
    // resolver: a blank key authenticates nothing and masks nothing.
    if (fromEnv !== undefined && fromEnv.trim() !== '') {
      return { value: fromEnv, requirement: { resolved: true, source: 'process-env' } }
    }
    return {
      requirement: {
        resolved: false,
        reason: `env var ${item.valueFromEnv} is ${fromEnv === undefined ? 'not set' : 'set but empty'}`,
      },
    }
  }
  // The declaration-only shape: the recipe says the app needs this variable and the
  // value was meant to come from the overlay, which does not carry it (yet).
  return {
    requirement: {
      resolved: false,
      reason: `no value — set it under "${item.name}" in .truecourse/scenarios/externals.local.json (or declare valueFromEnv)`,
    },
  }
}

/** Resolve every declared external against `env`, in declaration order. */
export function resolveExternals(
  declared: Record<string, RecipeApiExternal> | undefined,
  local: ExternalsLocalFile,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedExternal[] {
  return mergeExternals(declared, local).map((m) => resolveExternal(m, env))
}

/** Load the overlay from disk and resolve — the runner/generator entry point. */
export function loadResolvedExternals(
  repoRoot: string,
  declared: Record<string, RecipeApiExternal> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedExternal[] {
  return resolveExternals(declared, loadExternalsLocal(repoRoot), env)
}

/**
 * The env every PROVIDED external contributes to the SERVER process, merged in
 * declaration order. Unprovided/incomplete services contribute nothing.
 */
export function externalsInjectEnv(resolved: readonly ResolvedExternal[]): Record<string, string> {
  const env: Record<string, string> = {}
  for (const external of resolved) Object.assign(env, external.inject)
  return env
}

/** One provided service and every base-URL variable the runner must proxy. */
export interface ExternalProxyTarget {
  service: string
  /** Base-URL env var → the REAL origin behind it (the proxy's upstream). */
  endpoints: { envVar: string; url: string }[]
}

/**
 * The proxy layer's input: every PROVIDED external, with all of its
 * base-URL variables. Unprovided/incomplete services contribute nothing — there is
 * no upstream to forward to, and their flows stay blocked exactly as before.
 */
export function externalProxyTargets(
  resolved: readonly ResolvedExternal[],
): ExternalProxyTarget[] {
  return resolved
    .filter((e) => e.state === 'provided' && e.endpoints.length > 0)
    .map((e) => ({ service: e.service, endpoints: e.endpoints.map((x) => ({ ...x })) }))
}

/** Every provided external's secret values, keyed `<service>.<VAR>` for the redactor. */
export function externalsSecrets(resolved: readonly ResolvedExternal[]): Map<string, string> {
  const secrets = new Map<string, string>()
  for (const external of resolved) {
    for (const { label, value } of external.secrets) secrets.set(label, value)
  }
  return secrets
}

/**
 * The run-stopping message for an `incomplete` external, mirroring
 * `CredentialResolutionError`'s wording: the scenarios in the corpus were authored
 * against a live account that this machine cannot reach, so running them would
 * blame the app for an infrastructure gap.
 */
export function incompleteExternalMessage(external: ResolvedExternal): string {
  const missing = external.requirements
    .filter((r) => !r.resolved)
    .map((r) => `${r.envVar} (${r.reason ?? 'unresolved'})`)
    .join('; ')
  return (
    `external service "${external.service}" is declared in api.externals but only partly configured: ${missing}. ` +
    `Complete it in .truecourse/scenarios/externals.local.json (or unset the rest of the declaration to leave the service unprovided).`
  )
}

/** The first `incomplete` external, or null. */
export function firstIncompleteExternal(
  resolved: readonly ResolvedExternal[],
): ResolvedExternal | null {
  return resolved.find((e) => e.state === 'incomplete') ?? null
}

/**
 * The `incomplete` services among `resolved` that `services` names — i.e. which
 * half-configured accounts a single scenario actually depends on.
 *
 * A scenario BINDS an external by naming it in `setup.externals` (a fault script);
 * that is the only place a scenario says "this flow drives that vendor". Every other
 * scenario is indifferent to whether the account is configured, because an
 * `incomplete` service contributes no `inject` and no `secrets` (see
 * {@link resolveExternal}) — booting the app with one declared is byte-identical to
 * booting it with an `unprovided` one, which guard does routinely. So the runner
 * refuses THESE scenarios rather than the whole run; see the call site in `run.ts`.
 *
 * Returned in declaration order, so the first entry is a stable choice of culprit.
 */
export function boundIncompleteExternals(
  services: Iterable<string> | undefined,
  resolved: readonly ResolvedExternal[],
): ResolvedExternal[] {
  if (!services) return []
  const named = new Set(services)
  return resolved.filter((e) => e.state === 'incomplete' && named.has(e.service))
}
