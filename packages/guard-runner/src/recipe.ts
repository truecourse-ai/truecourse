/**
 * The preparation recipe (`.truecourse/scenarios/recipe.json`) — how to turn the
 * working tree into something scenarios can drive. `build` runs once per run in
 * the repo root; `entry` (argv, the cli driver's preparation) is stored
 * repo-relative and resolved to absolute at run time so a sandbox in a temp dir
 * can still invoke the built binary. The optional `api` block is the api
 * driver's preparation: how to START the built HTTP server (`serve` argv, same
 * resolution as `entry`), how to know it's ready (`healthPath` polled until
 * 2xx), and optional one-shot `services` commands for datastores the server
 * needs. The runner allocates a free port per boot and injects it as `PORT`.
 *
 * The recipe also carries an inputs fingerprint — a hash of the files that would
 * inform discovery (package.json, the lockfile, build config). This phase records
 * the fingerprint into the run store; staleness enforcement is a later phase.
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { z } from 'zod'
import { GUARD_HTTP_METHODS } from '@truecourse/shared'
import { recipePath } from './store.js'

/**
 * A credential MINTED BY A LOGIN REQUEST (`fromRequest`, item 59b): one HTTP call
 * the runner makes ONCE per run against the freshly booted server, whose captured
 * response value becomes the credential's secret. It replaces the shell `api.seed`
 * for the common simple case — an app whose only prerequisite is "log in and use
 * the token" — with no script to write and no manifest contract.
 *
 * The value comes from exactly one of `capture` (a dotted path into the JSON
 * response body, `""` for the root) or `captureHeader` (a response header name,
 * case-insensitive) — the same two sources an api STEP captures from. `template`
 * is opt-in and defaults to the captured value VERBATIM (the runner never invents
 * a `Bearer ` prefix; write `"template": "Bearer ${value}"` when the API wants
 * one — the Authorization shape warning nudges you if you forget).
 *
 * **Survival contract** — the same one `api.seed` carries. The login runs against
 * the run-level PREFLIGHT server; every scenario then boots its OWN fresh server.
 * A minted credential therefore stays valid only when the auth state outlives the
 * process: a stateless signed token (a JWT signed with a static secret, verifiable
 * by any instance) or a session row in an external datastore brought up by
 * `api.services.up`. An app that keeps sessions in process memory will 401 in every
 * scenario — use `api.seed` against a real store, or log in inside the scenario.
 *
 * Not a secret carrier: `fromRequest` lives in committed `recipe.json` and enters
 * the recipe fingerprint whole (unlike an inline `value`, which is stripped), so a
 * changed login path re-plans authoring — do NOT put a real password in its body;
 * use a development account the repo already commits.
 */
export const RecipeApiCredentialRequestSchema = z
  .object({
    method: z.enum(GUARD_HTTP_METHODS),
    /** Login path incl. query, e.g. `/auth/login`. Must start with `/`. */
    path: z.string().regex(/^\//, 'path must start with /'),
    headers: z.record(z.string(), z.string()).optional(),
    /** Raw request body, sent byte-for-byte. */
    body: z.string().optional(),
    /** JSON request body; serialized and sent with `content-type: application/json`. */
    json: z.unknown().optional(),
    /** Dotted path into the JSON response body (`token`, `data.jwt`, `""` = root). */
    capture: z.string().optional(),
    /** Response header the value is read from instead (case-insensitive). */
    captureHeader: z.string().min(1).optional(),
    /** Wrapper around the captured value; must contain `${value}`. Default: verbatim. */
    template: z.string().min(1).optional(),
  })
  .strict()
  .refine((r) => r.body === undefined || r.json === undefined, {
    message: 'a credential request carries `body` or `json`, not both',
  })
  .refine((r) => (r.capture !== undefined) !== (r.captureHeader !== undefined), {
    message: 'a credential request captures its value from exactly one of `capture` (body path) or `captureHeader`',
  })
  .refine((r) => r.template === undefined || r.template.includes('${value}'), {
    message: 'a credential request `template` must contain the `${value}` placeholder',
  })

/**
 * One declared api credential: an opaque name (the map key, e.g. `api-key`) →
 * the request HEADER the runner injects it as, plus its source — exactly one of a
 * literal `value`, a `valueFromEnv` env-var name resolved from the host process at
 * run start, or a `fromRequest` login call the runner makes once the server is up
 * (see {@link RecipeApiCredentialRequestSchema}). Scenarios reference the credential
 * by placing `{{cred:<name>}}` in a header value; the runner substitutes the resolved
 * secret at request time and masks it back out of every evidence transcript.
 */
export const RecipeApiCredentialSchema = z
  .object({
    /** The request header the credential is injected as (advertised to authoring). */
    header: z.string().min(1),
    /** A literal secret value (kept out of every hash — a rotation never re-plans). */
    value: z.string().min(1).optional(),
    /** Host env-var name the value is read from at run start (missing → hard error). */
    valueFromEnv: z.string().min(1).optional(),
    /** A login request the runner makes once per run to mint the value (item 59b). */
    fromRequest: RecipeApiCredentialRequestSchema.optional(),
    /**
     * A short human phrase naming the principal/role this credential authenticates
     * as ("org owner", "regular member", "admin") — advertised next to the name at
     * authoring so the model picks the right principal for a role-sensitive claim.
     * NOT a secret: it participates in the fingerprint (it changes authoring output).
     */
    description: z.string().min(1).optional(),
    /**
     * The NAME of the OpenAPI security scheme this credential fulfills (B7) — e.g.
     * `apiKeyAuth`, matching a key under `components.securitySchemes`. When set it is
     * authoritative: guard generate maps the scheme to this credential directly rather
     * than heuristically inferring it from the header, and it lets a credential satisfy
     * a scheme the heuristics never match (oauth2/openIdConnect bearer tokens). A
     * capability, not a secret: it participates in the fingerprint (a change re-plans).
     */
    satisfies: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (c) =>
      [c.value, c.valueFromEnv, c.fromRequest].filter((source) => source !== undefined).length === 1,
    { message: 'a credential carries exactly one of `value`, `valueFromEnv`, or `fromRequest`' },
  )

/**
 * One seed-provided credential DECLARATION (`api.seed.provides.credentials`): the
 * request `header` the runner injects it as, plus its optional role `description`.
 * Unlike {@link RecipeApiCredentialSchema} it carries NO source — the concrete
 * value is minted by the seed command at run time and emitted in the manifest, so
 * it never appears in recipe.json and never enters any hash.
 */
export const RecipeApiSeedCredentialSchema = z
  .object({
    header: z.string().min(1),
    description: z.string().min(1).optional(),
    /** The OpenAPI security scheme this seed-minted credential fulfills (see
     *  {@link RecipeApiCredentialSchema}.satisfies) — e.g. a `bearerAuth` scheme
     *  satisfied by the seed's minted token. */
    satisfies: z.string().min(1).optional(),
  })
  .strict()

/**
 * The optional seed stage under `api`. `command` (sh -c, repo root) runs ONCE per
 * guard run after `services.up` and BEFORE the server boots; it writes a JSON
 * manifest to the file named by the `GUARD_SEED_OUT` env var. `provides` is the
 * STATIC declaration authoring and staleness key on: which credentials the seed
 * mints (name → header + optional role description) and which fixtures it emits
 * (name → the field names available on it). Runtime manifest VALUES are never
 * declared here, so they never reach a fingerprint.
 */
export const RecipeApiSeedSchema = z
  .object({
    /** Shell command (sh -c) run once per run in the repo root; writes `GUARD_SEED_OUT`. */
    command: z.string().min(1),
    /**
     * The repo-relative SCRIPT FILE `command` runs, when the command is a script
     * invocation (`node scripts/guard-seed.mjs` → `scripts/guard-seed.mjs`). The
     * RUNTIME ignores it completely — `command` is the whole execution contract.
     * Its only job is STALENESS: `computeRecipeFingerprint` folds this file's
     * CONTENT, so editing the seed script re-authors the sections that generate
     * against it, exactly as editing `provides` does. Declared explicitly rather
     * than parsed out of `command` — a shell string has no reliable file argument,
     * and a fingerprint that silently guesses wrong is worse than one that asks.
     */
    script: z.string().min(1).optional(),
    /** What the seed emits — the authoring catalog + the manifest-validation contract. */
    provides: z
      .object({
        /** Credentials the seed mints: name → the header it is injected as (+ role). */
        credentials: z.record(z.string().min(1), RecipeApiSeedCredentialSchema).optional(),
        /** Fixtures the seed emits: name → the field names available for `{{fixture:…}}`. */
        fixtures: z.record(z.string().min(1), z.array(z.string().min(1)).min(1)).optional(),
      })
      .strict(),
  })
  .strict()

/**
 * One env var an external service needs BEYOND its base URL (an API key, an
 * account id). Same never-two-sources discipline as
 * {@link RecipeApiCredentialSchema}: `value` and `valueFromEnv` are mutually
 * exclusive, so a recipe can never carry two answers for one variable. `value` is
 * stripped from the fingerprint (a rotated key never re-plans) — but an inline
 * `value` in a COMMITTED recipe.json is still a secret in git.
 *
 * Unlike a credential, NEITHER source is also legal, and it is the RECOMMENDED
 * shape for a real key: `{}` DECLARES that the app needs this variable while the
 * value comes from the gitignored `scenarios/externals.local.json` overlay (see
 * `./externals.ts`). The declaration — which the team shares — then travels
 * separately from the secret, which never does.
 */
export const RecipeApiExternalEnvSchema = z
  .object({
    /** A literal value (kept out of every hash; prefer the local overlay for secrets). */
    value: z.string().min(1).optional(),
    /** Host env-var name the value is read from at run start. */
    valueFromEnv: z.string().min(1).optional(),
  })
  .strict()
  .refine((e) => e.value === undefined || e.valueFromEnv === undefined, {
    message:
      'an external env var carries at most one of `value` or `valueFromEnv` (neither ⇒ its value comes from the gitignored externals.local.json overlay)',
  })

/**
 * ONE user-provided external API account (item 62): a third party the app talks to
 * for real, against a SANDBOX or REAL account the user supplied, instead of being
 * stubbed or left blocked.
 *
 * `baseUrlEnv` is the env var THE APP reads that service's base URL from — the
 * declaration is what makes the service addressable at all, and it is the same
 * variable a `setup.http` stub points at (a scenario that stubs the service still
 * wins for that scenario). `baseUrl` is the origin the user provided.
 *
 * A declared entry with no `baseUrl` and no resolvable `env` is DECLARED but NOT
 * PROVIDED: authoring keeps treating the service as a blocker. That distinction is
 * computed in exactly one place — `resolveExternal` in `./externals.ts`.
 */
export const RecipeApiExternalSchema = z
  .object({
    /** The env var the APP reads this service's base URL from (e.g. `GEOCODING_BASE_URL`). */
    baseUrlEnv: z.string().min(1),
    /** The sandbox/real origin the user provided; absent ⇒ declared but not provided. */
    baseUrl: z
      .string()
      .regex(/^https?:\/\/\S+$/, 'baseUrl must be an absolute http(s) URL')
      .optional(),
    /**
     * EXTRA base-URL variables of the SAME service (item 64): env var → the origin
     * it points at. A vendor reached through several hosts (open-meteo's geocoding
     * host beside its forecast host) has one variable per host, and the runner must
     * know they are BASE URLS — an origin is what it proxies, a key is what it
     * forwards. Before this block such a variable could only be modelled as an `env`
     * row with an inline URL value, which reads as a secret-shaped credential and
     * carries no promise that the value is an origin.
     *
     * Each endpoint resolves exactly like `baseUrl` (recipe value, overridable by the
     * overlay's `endpoints`), counts as one requirement, and gets its OWN loopback
     * proxy at run time — while sharing the service's fault script and call log.
     * `env` stays the home of KEYS.
     */
    endpoints: z
      .record(
        z.string().min(1),
        z.string().regex(/^https?:\/\/\S+$/, 'an endpoint must be an absolute http(s) URL'),
      )
      .optional(),
    /** Whether the provided account is a vendor SANDBOX or the REAL one (authoring copy). */
    mode: z.enum(['sandbox', 'real']).optional(),
    /** Extra env the app needs for this service (API keys), name → its source. */
    env: z.record(z.string().min(1), RecipeApiExternalEnvSchema).optional(),
    /** Human note about the account ("shared sandbox org", "read-only key"). */
    description: z.string().min(1).optional(),
  })
  .strict()

/** The api driver's preparation layer — how to boot + health-check the server. */
export const RecipeApiSchema = z
  .object({
    /** Argv that starts the HTTP server (resolved like `entry`). The runner sets `PORT`. */
    serve: z.array(z.string()).min(1),
    /** Health endpoint polled until it returns 2xx. Defaults to `/`. */
    healthPath: z.string().regex(/^\//, 'healthPath must start with /').optional(),
    /** Wall-clock budget for the server to become healthy. Defaults to 30s. */
    readyTimeoutMs: z.number().int().positive().optional(),
    /** Extra env for the server process (on top of the recipe-level `env`). */
    env: z.record(z.string(), z.string()).optional(),
    /**
     * One-shot datastore orchestration, run in the repo root once per run:
     * `up` before any api scenario, `down` (optional) after the last one.
     * The runner does no orchestration itself — these are the repo's own commands
     * (e.g. `docker compose up -d db`).
     */
    services: z
      .object({ up: z.string().min(1), down: z.string().min(1).optional() })
      .strict()
      .optional(),
    /**
     * Named request-header credentials the runner injects into scenario steps that
     * reference `{{cred:<name>}}`. Names are opaque identifiers; values are never
     * authored into scenarios and never enter any fingerprint.
     */
    credentials: z.record(z.string().min(1), RecipeApiCredentialSchema).optional(),
    /**
     * The optional seed stage: an authenticated one-shot that mints credentials and
     * fixtures before any scenario runs (see {@link RecipeApiSeedSchema}).
     */
    seed: RecipeApiSeedSchema.optional(),
    /**
     * User-provided external API accounts (item 62): service name → the account the
     * runner configures the app to reach. See {@link RecipeApiExternalSchema}.
     */
    externals: z.record(z.string().min(1), RecipeApiExternalSchema).optional(),
  })
  .strict()
  // A credential name declared in BOTH `credentials` and `seed.provides.credentials`
  // is ambiguous (two sources for one `{{cred:<name>}}`) — refuse loudly at load time
  // rather than silently pick one.
  .superRefine((api, ctx) => {
    const seeded = api.seed?.provides.credentials
    if (!api.credentials || !seeded) return
    for (const name of Object.keys(seeded)) {
      if (name in api.credentials) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `credential "${name}" is declared in both api.credentials and api.seed.provides.credentials — a name has exactly one source`,
          path: ['seed', 'provides', 'credentials', name],
        })
      }
    }
  })
  // Two externals writing the SAME server env var is ambiguous — the injection would
  // silently pick one and the app would reach the wrong account. Refuse at load time,
  // for both the base-URL var and the extra per-service env vars.
  .superRefine((api, ctx) => {
    if (!api.externals) return
    const owner = new Map<string, string>()
    for (const [service, external] of Object.entries(api.externals)) {
      // Endpoints are base-URL variables like `baseUrlEnv` itself, so they share the
      // one-variable-one-owner rule — WITHIN a service too: the same name in both
      // `endpoints` and `env` would ask the runner to inject an origin and a key
      // into one variable.
      const vars = [
        external.baseUrlEnv,
        ...Object.keys(external.endpoints ?? {}),
        ...Object.keys(external.env ?? {}),
      ]
      const seen = new Set<string>()
      for (const name of vars) {
        if (seen.has(name)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `env var ${name} is declared twice by api.externals."${service}" (baseUrlEnv / endpoints / env name it more than once) — one variable has exactly one source`,
            path: ['externals', service],
          })
          continue
        }
        seen.add(name)
        const previous = owner.get(name)
        if (previous !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `env var ${name} is declared by both api.externals."${previous}" and api.externals."${service}" — one variable has exactly one owner`,
            path: ['externals', service],
          })
        } else {
          owner.set(name, service)
        }
      }
    }
  })

export const RecipeSchema = z
  .object({
    /** Optional shell command run once in the repo root, before every build, to fetch dependencies. */
    install: z.string().min(1).optional(),
    /** Shell command run once in the repo root to produce the entrypoint/server. */
    build: z.string().min(1),
    /** Entrypoint argv (cli driver); scenario `run` argv is appended to this. Repo-relative. */
    entry: z.array(z.string()).min(1).optional(),
    env: z.record(z.string(), z.string()).optional(),
    /**
     * Hosts the repo OWNS — its deployed origins (`cal.com`, `app.acme.io`). A URL
     * literal in the tree pointing at one of these (or any subdomain) is the app
     * talking about itself, not a third-party dependency, so external-service
     * detection skips it and nothing ever reads "blocked on <your own product>".
     * Entries may be bare hosts or full URLs; matching is host + subdomains.
     * Committed and fingerprinted like every recipe field, so declaring a host
     * re-authors the sections it used to block.
     */
    ownHosts: z.array(z.string().min(1)).optional(),
    /** The api driver's preparation layer; present when the repo has api scenarios. */
    api: RecipeApiSchema.optional(),
  })
  .strict()
  .refine((r) => r.entry !== undefined || r.api !== undefined, {
    message: 'recipe needs an `entry` (cli driver) and/or an `api` block (api driver)',
  })

export type RecipeApiCredential = z.infer<typeof RecipeApiCredentialSchema>
export type RecipeApiCredentialRequest = z.infer<typeof RecipeApiCredentialRequestSchema>
export type RecipeApiSeedCredential = z.infer<typeof RecipeApiSeedCredentialSchema>
export type RecipeApiSeed = z.infer<typeof RecipeApiSeedSchema>
export type RecipeApiExternalEnv = z.infer<typeof RecipeApiExternalEnvSchema>
export type RecipeApiExternal = z.infer<typeof RecipeApiExternalSchema>
export type RecipeApi = z.infer<typeof RecipeApiSchema>
export type Recipe = z.infer<typeof RecipeSchema>

/**
 * The env vars whose run-time value the RECIPE pins — `env` ∪ `api.env`, minus any
 * variable an `api.externals` entry owns (its `baseUrlEnv`, `endpoints`, or `env`
 * keys). The externals carve-out matters: a variable declared as a third party's
 * base URL points AWAY from the app by definition, so it must never feed the
 * own-host derivation even if a recipe also lists it under `env`. Sorted for
 * stable downstream hashing.
 */
export function recipeControlledEnvVars(recipe: Recipe): string[] {
  const externalsOwned = new Set<string>()
  for (const external of Object.values(recipe.api?.externals ?? {})) {
    externalsOwned.add(external.baseUrlEnv)
    for (const name of Object.keys(external.endpoints ?? {})) externalsOwned.add(name)
    for (const name of Object.keys(external.env ?? {})) externalsOwned.add(name)
  }
  const controlled = new Set<string>()
  for (const name of [...Object.keys(recipe.env ?? {}), ...Object.keys(recipe.api?.env ?? {})]) {
    if (!externalsOwned.has(name)) controlled.add(name)
  }
  return [...controlled].sort()
}

/** A credential resolved to its concrete secret at run start. */
export interface ResolvedCredential {
  header: string
  value: string
}

/** A declared credential referenced a host env var that is not set at run time. */
export class CredentialResolutionError extends Error {}

/**
 * Resolve every STATICALLY-sourced api credential to its concrete secret at run
 * start: inline `value`s pass through; `valueFromEnv` reads the host process env,
 * and a missing var is a hard {@link CredentialResolutionError} (never a silent skip
 * — an api scenario referencing the credential would otherwise run un-authenticated).
 * `fromRequest` credentials are SKIPPED here on purpose: their value is minted by a
 * login call that needs a booted server, so they resolve after the preflight (see
 * `runCredentialRequests`) and merge into this same map, exactly like seeded ones.
 * The returned map is keyed by credential name; values never enter any fingerprint.
 * Each resolved value is shape-checked ({@link credentialShapeWarning}) — a
 * console warning, never a stop.
 */
export function resolveApiCredentials(
  credentials: Record<string, RecipeApiCredential> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Map<string, ResolvedCredential> {
  const resolved = new Map<string, ResolvedCredential>()
  for (const [name, cred] of Object.entries(credentials ?? {})) {
    let value: string
    if (cred.fromRequest !== undefined) {
      continue
    } else if (cred.value !== undefined) {
      value = cred.value
    } else {
      const fromEnv = env[cred.valueFromEnv!]
      // Unset OR set-but-blank both fail loudly — a blank secret would inject an
      // empty header and run un-authenticated, and the redactor has nothing to mask.
      // This mirrors the schema's `min(1)` floor on an inline `value`.
      if (fromEnv === undefined || fromEnv.trim() === '') {
        throw new CredentialResolutionError(
          `credential "${name}" reads its value from env var ${cred.valueFromEnv}, which is ${fromEnv === undefined ? 'not set' : 'set but empty'}`,
        )
      }
      value = fromEnv
    }
    resolved.set(name, { header: cred.header, value })
  }
  // Shape diagnostics AFTER every value resolved, so one run prints one block.
  warnCredentialShapes(resolved)
  return resolved
}

/**
 * The HTTP authentication schemes an `Authorization` header value may legitimately
 * open with, in their canonical RFC casing — the IANA registry's live entries plus
 * the three de-facto customs (`Token`, `ApiKey`, AWS SigV4) real APIs ship. Used
 * ONLY to recognise a value's shape (item 56): a credential injected verbatim into
 * `Authorization` that starts with none of these is almost certainly a raw token
 * that will 401 on every request.
 */
const AUTH_SCHEME_TOKENS: readonly string[] = [
  'Basic',
  'Bearer',
  'Concealed',
  'Digest',
  'DPoP',
  'GNAP',
  'HOBA',
  'Mutual',
  'Negotiate',
  'NTLM',
  'OAuth',
  'PrivateToken',
  'SCRAM-SHA-1',
  'SCRAM-SHA-256',
  'vapid',
  'Token',
  'ApiKey',
  'AWS4-HMAC-SHA256',
]

/**
 * Shape-check a resolved credential destined for `Authorization` (item 56 / Phase 2).
 * The runner injects the value VERBATIM, so an `Authorization` credential holding a
 * bare token (`eyJhbGci…` rather than `Bearer eyJhbGci…`) authenticates nothing and
 * every api scenario dies on a silent 401. The check is purely on shape — the runner
 * has no scheme knowledge (that lives in the generator) and needs none: any header
 * other than `Authorization` is never inspected, and the result is a WARNING, never a
 * run stop (a proprietary scheme is legal).
 *
 * Returns the warning line, or `null` when the value is fine. The secret NEVER appears
 * in the message — only the credential name and the scheme token it opened with.
 */
export function credentialShapeWarning(name: string, cred: ResolvedCredential): string | null {
  if (cred.header.toLowerCase() !== 'authorization') return null
  const first = cred.value.split(' ', 1)[0] ?? ''
  const canonical = AUTH_SCHEME_TOKENS.find((t) => t.toLowerCase() === first.toLowerCase())
  if (canonical === undefined) {
    return (
      `credential "${name}" is injected into the Authorization header but its value does not start with an ` +
      `auth-scheme token (\`Bearer \`, \`Basic \`, …). The value is sent verbatim, so a bare token authenticates ` +
      `nothing — prefix it (e.g. \`Bearer <token>\`) unless the API really expects a scheme-less credential.`
    )
  }
  // RFC 6750/7235 make the scheme token case-insensitive on the wire, but plenty of
  // servers compare it literally — nudge, never block.
  if (canonical !== first) {
    return `credential "${name}" opens its Authorization value with "${first}"; the canonical spelling is "${canonical}" — some servers compare it case-sensitively.`
  }
  return null
}

/**
 * Emit the {@link credentialShapeWarning} lines for a resolved credential set.
 * Console-level (the seed stage's undeclared-key warning sets the precedent): a
 * non-fatal notice the run prints and carries on from. Never throws, never records
 * the value.
 */
export function warnCredentialShapes(credentials: Iterable<[string, ResolvedCredential]>): void {
  for (const [name, cred] of credentials) {
    const warning = credentialShapeWarning(name, cred)
    // eslint-disable-next-line no-console -- surfacing a silent-401 shape is the point.
    if (warning) console.warn(`[guard credentials] ${warning}`)
  }
}

/** Default health path polled on the booted api server. */
export const DEFAULT_API_HEALTH_PATH = '/'
/** Default wall-clock budget for the api server to become healthy. */
export const DEFAULT_API_READY_TIMEOUT_MS = 30_000

export interface LoadedRecipe {
  recipe: Recipe
  /** `sha256:…` over the discovery-input files present in the repo. */
  fingerprint: string
}

/**
 * Files whose contents inform recipe discovery; the fingerprint hashes those present.
 *
 * `docker-compose.guard.yml` is the datastore guard GENERATES (item 68) and the
 * recipe's `api.services` runs: its contents decide which engine, which database,
 * and which credentials the scenarios ran against, so editing it changes the world
 * as surely as editing the recipe does — and must re-author what was authored
 * against the old one. Hashed only if present, so every repo without one folds
 * nothing and keeps the fingerprint it had. The user's OWN compose files are
 * deliberately NOT here: they are the repo's, they move for reasons that have
 * nothing to do with guard, and a recipe that names one already folds that name.
 */
const FINGERPRINT_INPUTS: readonly string[] = [
  'package.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'turbo.json',
  'docker-compose.guard.yml',
]

export class RecipeError extends Error {}

/** Load + validate the recipe, or `null` when the file is absent. */
export function loadRecipe(repoRoot: string, recipeFile: string): LoadedRecipe | null {
  if (!fs.existsSync(recipeFile)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(recipeFile, 'utf-8'))
  } catch (e) {
    throw new RecipeError(`recipe.json is not valid JSON: ${e instanceof Error ? e.message : e}`)
  }
  const result = RecipeSchema.safeParse(parsed)
  if (!result.success) {
    throw new RecipeError(`recipe.json is invalid: ${result.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`)
  }
  return { recipe: result.data, fingerprint: computeRecipeFingerprint(repoRoot) }
}

/** Hash the present discovery-input files (sorted, path-tagged) into one digest. */
export function computeRecipeFingerprint(repoRoot: string): string {
  const hash = crypto.createHash('sha256')
  for (const rel of FINGERPRINT_INPUTS) {
    const abs = path.join(repoRoot, rel)
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue
    hash.update(rel)
    hash.update('\0')
    hash.update(fs.readFileSync(abs))
    hash.update('\0')
  }
  // Fold the recipe file itself so a recipe edit (its serve argv, health path, or
  // the DECLARED credential capability set — names + headers + env sources) re-keys
  // every section that generates against it. Credential VALUES are stripped first so
  // a rotated secret never re-plans, and a secret never enters the fingerprint.
  const recipeAbs = recipePath(repoRoot)
  if (fs.existsSync(recipeAbs) && fs.statSync(recipeAbs).isFile()) {
    const raw = fs.readFileSync(recipeAbs, 'utf-8')
    hash.update('recipe.json')
    hash.update('\0')
    hash.update(hashableRecipeText(raw))
    hash.update('\0')
    // The seed SCRIPT is a recipe input the recipe only NAMES (`api.seed.script`):
    // its content decides what rows exist when a scenario runs, so editing it must
    // re-author the flows that were authored against those rows — the same rule
    // `provides` already obeys. Absent, unreadable, or pointing outside the repo:
    // nothing is folded, and staleness is exactly what it was before the field.
    const scriptAbs = resolveSeedScript(repoRoot, raw)
    if (scriptAbs) {
      hash.update('api.seed.script')
      hash.update('\0')
      hash.update(fs.readFileSync(scriptAbs))
      hash.update('\0')
    }
  }
  return `sha256:${hash.digest('hex')}`
}

/**
 * The absolute path of the recipe's declared seed script, or `null` when there is
 * none, it does not exist, or it escapes the repo (a `../` path is never read —
 * the fingerprint hashes repository content, nothing above it).
 */
export function resolveSeedScript(repoRoot: string, rawRecipe: string): string | null {
  let rel: unknown
  try {
    rel = (JSON.parse(rawRecipe) as { api?: { seed?: { script?: unknown } } })?.api?.seed?.script
  } catch {
    return null // a malformed recipe fails the run anyway; it names no script here
  }
  if (typeof rel !== 'string' || rel.trim() === '') return null
  const abs = path.resolve(repoRoot, rel)
  const root = path.resolve(repoRoot)
  if (abs !== root && !abs.startsWith(root + path.sep)) return null
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null
  return abs
}

/**
 * The recipe text folded into the fingerprint: a CANONICAL JSON re-serialization
 * (object keys recursively sorted, so a pure key reordering does not re-plan) with
 * every credential's inline `value` stripped, so the capability set (names, headers,
 * env sources) drives staleness while a rotated secret does not — and no secret ever
 * reaches the digest. A `fromRequest` login block is NOT stripped: it declares a
 * capability (which endpoint mints the credential), carries no secret by contract,
 * and a changed login path should re-plan. Unparseable JSON is hashed verbatim (a malformed recipe fails
 * the run regardless, and carries no schema-valid credential to leak).
 *
 * `api.externals` (item 62) follows the SAME split, one level deeper: every
 * `env.<VAR>.value` is stripped (a rotated key never re-plans) while the
 * DECLARATION — the service name, its `baseUrlEnv`/`baseUrl`/`mode`, and which env
 * vars it needs — stays in the digest. Declaring a provided external is exactly the
 * self-unblocking signal that SHOULD re-author the sections it blocked. The
 * gitignored `externals.local.json` overlay never reaches this function at all, so
 * supplying a secret (or a rotated sandbox URL) locally is fingerprint-neutral by
 * construction.
 */
export function hashableRecipeText(raw: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return raw
  }
  const api = (parsed as {
    api?: {
      credentials?: Record<string, unknown>
      externals?: Record<string, { env?: Record<string, unknown> } | null>
    }
  })?.api
  const externals = api?.externals
  if (externals && typeof externals === 'object') {
    for (const external of Object.values(externals)) {
      const env = external?.env
      if (!env || typeof env !== 'object') continue
      for (const entry of Object.values(env)) {
        if (entry && typeof entry === 'object' && 'value' in entry) {
          delete (entry as Record<string, unknown>).value
        }
      }
    }
  }
  const creds = api?.credentials
  if (creds && typeof creds === 'object') {
    for (const cred of Object.values(creds)) {
      if (cred && typeof cred === 'object' && 'value' in cred) {
        delete (cred as Record<string, unknown>).value
      }
    }
  }
  return JSON.stringify(canonicalizeJson(parsed))
}

/** Recursively sort object keys (arrays keep order — argv order is meaningful) so
 *  the recipe fingerprint is invariant to JSON key ordering. */
function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalizeJson((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}

/**
 * Resolve the recipe entry argv to absolute paths. A bare command (argv[0], e.g.
 * `node`) is pinned to an absolute path via the HOST's PATH at run start, before
 * any sandbox env applies — so a scenario's `setup.env.PATH` override can inject
 * stub executables for CHILD processes the program spawns, but can never swap the
 * interpreter that runs the program under test. Path-like args that resolve to an
 * existing repo file are absolutized so the sandbox — whose cwd is a temp dir —
 * invokes the built artifact.
 *
 * A DIRECTORY argument is absolutized only when it is path-ANCHORED (`.`, `./x`,
 * or anything containing a separator): `uvicorn --app-dir .` names the repo root
 * the app is imported from, and left relative it would resolve to the sandbox's
 * empty temp cwd. The anchoring requirement is what keeps a bare subcommand that
 * happens to collide with a repo directory (`dotnet build`, `run`, `Release`) a
 * subcommand — only a path the author wrote AS a path is treated as one.
 */
export function resolveEntry(repoRoot: string, entry: readonly string[]): string[] {
  const [command, ...rest] = entry
  const resolvedCommand = isBareCommand(command)
    ? resolveOnHostPath(command)
    : path.resolve(repoRoot, command)
  const resolvedRest = rest.map((arg) => {
    if (path.isAbsolute(arg)) return arg
    const abs = path.resolve(repoRoot, arg)
    if (!fs.existsSync(abs)) return arg
    const stat = fs.statSync(abs)
    if (stat.isFile()) return abs
    return stat.isDirectory() && isPathAnchored(arg) ? abs : arg
  })
  return [resolvedCommand, ...resolvedRest]
}

/** `.`, `./x`, `../x`, `a/b` — written as a path, not as a bare word. */
function isPathAnchored(arg: string): boolean {
  return arg === '.' || arg.startsWith('./') || arg.startsWith('../') || arg.includes('/') || arg.includes(path.sep)
}

/** A bare command (no separator, not `./`-anchored) is looked up on the host PATH. */
function isBareCommand(command: string): boolean {
  return !command.includes('/') && !command.includes(path.sep) && !command.startsWith('.')
}

/**
 * Resolve a bare command to an absolute executable using the HOST's `process.env.PATH`.
 * Returns the bare name unchanged when nothing on PATH matches (spawn resolves it
 * then). On Windows, PATHEXT extensions are tried.
 */
function resolveOnHostPath(command: string): string {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
      : ['']
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext)
      try {
        if (fs.statSync(candidate).isFile()) {
          fs.accessSync(candidate, fs.constants.X_OK)
          return candidate
        }
      } catch {
        // not here (missing / not executable) — keep scanning
      }
    }
  }
  return command
}
