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
import { dependenciesPath, recipePath } from './store.js'

/**
 * A credential MINTED BY A LOGIN REQUEST (`fromRequest`): one HTTP call
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
    /**
     * The `api.servers` key the login call runs against; absent ⇒ the recipe's
     * `defaultServer`. A login is a REQUEST, so it needs a server — and in a
     * multi-service repo the service that mints the token is rarely the one the
     * scenario drives (a web app's session endpoint for an api service's token).
     */
    server: z.string().min(1).optional(),
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
    /** A login request the runner makes once per run to mint the value. */
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
    /**
     * The `api.servers` this credential authenticates against. Absent ⇒ EVERY
     * server (the single-server behaviour every existing recipe has). A web
     * session cookie is not an api-v2 credential: declaring the allowlist keeps
     * authoring from advertising it to the wrong service's scenarios, and turns a
     * cross-server `{{cred:…}}` reference into an actionable scenario error rather
     * than a silent 401 blamed on the app.
     */
    servers: z.array(z.string().min(1)).min(1).optional(),
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
    /** The servers this seeded credential authenticates against; absent ⇒ every
     *  server. Same allowlist semantics as {@link RecipeApiCredentialSchema}.servers. */
    servers: z.array(z.string().min(1)).min(1).optional(),
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
 * ONE user-provided external API account: a third party the app talks to
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
     * EXTRA base-URL variables of the SAME service: env var → the origin
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

/** A recipe server NAME: lowercase, filename- and id-safe (it lands in scenario YAML). */
const SERVER_NAME = /^[a-z0-9][a-z0-9._-]*$/

/**
 * The name the single-server (`api.serve`) shape resolves to. Every recipe has at
 * least one named server after {@link resolveApiServers}, so nothing downstream
 * branches on which shape was written.
 */
export const DEFAULT_API_SERVER_NAME = 'default'

/**
 * ONE named HTTP service of a multi-service repo. A workspace that ships
 * a web app AND a separate api service has TWO servers, and a documented endpoint
 * of the second is untestable while the recipe names only the first — the cal.com
 * failure this exists for (30/39 scenarios died on the web app's HTML 404 page for
 * paths `apps/api/v2` serves).
 *
 * Every field is the single-server `api.serve` companion it replaces, scoped to
 * this service; `env` layers ABOVE the recipe-level `env` and `api.env` (the
 * SHARED layer) and below the externals injection the runner applies at boot.
 */
export const RecipeApiServerSchema = z
  .object({
    /** Argv that starts this service (resolved like `entry`). The runner sets `PORT`. */
    serve: z.array(z.string()).min(1),
    /** Where the process runs — see {@link RecipeApiSchema}.cwd. Defaults to `sandbox`. */
    cwd: z.enum(['sandbox', 'repo']).optional(),
    /** Health endpoint polled until it returns 2xx. Defaults to `/`. */
    healthPath: z.string().regex(/^\//, 'healthPath must start with /').optional(),
    /** Wall-clock budget for this service to become healthy. Defaults to 30s. */
    readyTimeoutMs: z.number().int().positive().optional(),
    /** Extra env for THIS server, layered above `env` and `api.env`. */
    env: z.record(z.string(), z.string()).optional(),
    /**
     * Repo-relative directory of the workspace app this server serves
     * (`apps/api/v2`). The JOIN KEY to the route manifest: it is what
     * lets guard say "this path is served by apps/api/v2, which has no server".
     * Optional — absent means the route gate simply does not apply to this
     * server, never a false block.
     */
    app: z.string().min(1).optional(),
    /** Human note about the service ("the public REST API", "the web frontend"). */
    description: z.string().min(1).optional(),
  })
  .strict()

/** The api driver's preparation layer — how to boot + health-check the server(s). */
export const RecipeApiSchema = z
  .object({
    /**
     * Argv that starts the HTTP server (resolved like `entry`). The runner sets `PORT`.
     * The SINGLE-server shape: a repo with more than one HTTP service declares
     * {@link RecipeApiSchema}.servers instead, and exactly one of the two is legal.
     */
    serve: z.array(z.string()).min(1).optional(),
    /**
     * The repo's HTTP services by name — the multi-server shape. Each
     * scenario binds to exactly one of them (`scenario.server`, defaulting to
     * `defaultServer`), so a documented path of ANY declared service is testable.
     * Mutually exclusive with `serve`.
     */
    servers: z
      .record(
        z.string().regex(SERVER_NAME, 'a server name is lowercase and filename-safe ([a-z0-9][a-z0-9._-]*)'),
        RecipeApiServerSchema,
      )
      .optional(),
    /** The `servers` key a scenario binds to when it names none. Required past one server. */
    defaultServer: z.string().min(1).optional(),
    /** The single-server shape's route-manifest join key — see {@link RecipeApiServerSchema}.app. */
    app: z.string().min(1).optional(),
    /**
     * Where the server process RUNS. `sandbox` (the default, the behavior every
     * existing recipe has): a per-scenario temp dir, so an app that writes state
     * files to its cwd gets a fresh world each scenario. `repo`: the repository
     * root — REQUIRED for a package-manager-mediated serve argv (`yarn workspace X
     * start`, `pnpm --filter X start`, `npm run start`): from a temp dir the
     * workspace root is invisible and corepack cannot see the root package.json's
     * `packageManager` pin, so the wrong tool version runs against no workspace at
     * all. Only the SERVER cwd moves; scenario `setup.files` still land in the
     * sandbox, so a `repo` server must not depend on cwd-local state files.
     */
    cwd: z.enum(['sandbox', 'repo']).optional(),
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
     * User-provided external API accounts: service name → the account the
     * runner configures the app to reach. See {@link RecipeApiExternalSchema}.
     */
    externals: z.record(z.string().min(1), RecipeApiExternalSchema).optional(),
  })
  .strict()
  // The two shapes are exclusive and one is required: a recipe declares either ONE
  // `api.serve` or a named `api.servers` map. Everything downstream reads the
  // resolved map (`resolveApiServers`), so this is the only place the shape exists.
  .superRefine((api, ctx) => {
    const named = Object.keys(api.servers ?? {})
    if ((api.serve !== undefined) === (named.length > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          api.serve === undefined
            ? 'the api block needs a `serve` argv (one server) or a non-empty `servers` map (several)'
            : 'a recipe declares either one `api.serve` or a named `api.servers` map, never both',
        path: ['serve'],
      })
      return
    }
    if (named.length === 0) return
    // With `servers`, the api-level `serve` COMPANIONS belong to a server entry —
    // an api-level `healthPath` beside two servers is an answer to a question that
    // now has two. `env` deliberately stays: it is the shared layer.
    for (const field of ['cwd', 'healthPath', 'readyTimeoutMs', 'app'] as const) {
      if (api[field] !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `api.${field} belongs to a server entry when the recipe declares \`api.servers\` — move it under the server it describes`,
          path: [field],
        })
      }
    }
    // R1: past one server, which one a scenario means is a decision, not a default.
    if (named.length > 1 && api.defaultServer === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `api.defaultServer must name one of the declared servers (${named.join(', ')}) — with more than one server there is no obvious default`,
        path: ['defaultServer'],
      })
    }
    if (api.defaultServer !== undefined && !named.includes(api.defaultServer)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `api.defaultServer "${api.defaultServer}" is not a declared server (${named.join(', ')})`,
        path: ['defaultServer'],
      })
    }
  })
  // A credential's `servers` allowlist may only name servers that exist — an
  // allowlist naming a typo would silently exclude the credential everywhere.
  .superRefine((api, ctx) => {
    const declared = api.servers ? Object.keys(api.servers) : [DEFAULT_API_SERVER_NAME]
    const check = (names: readonly string[] | undefined, at: (string | number)[]): void => {
      for (const name of names ?? []) {
        if (declared.includes(name)) continue
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `server "${name}" is not declared by this recipe (declared: ${declared.join(', ')})`,
          path: at,
        })
      }
    }
    for (const [name, cred] of Object.entries(api.credentials ?? {})) {
      check(cred.servers, ['credentials', name, 'servers'])
      check(cred.fromRequest?.server ? [cred.fromRequest.server] : undefined, [
        'credentials',
        name,
        'fromRequest',
        'server',
      ])
    }
    for (const [name, cred] of Object.entries(api.seed?.provides.credentials ?? {})) {
      check(cred.servers, ['seed', 'provides', 'credentials', name, 'servers'])
    }
  })
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

/**
 * The web driver's preparation layer — how the WEB SURFACE starts and how its
 * readiness is observed. Deliberately the api server block's fields under the same
 * names (`serve`, `cwd`, `healthPath`, `readyTimeoutMs`, `env`): a served web
 * surface IS a served process, it boots through the very same machinery
 * (`spawnApiProcess` + `awaitApiServerReady`), and giving the same concept two
 * spellings would be the fork this parallel exists to avoid.
 *
 * The one field the api block has no use for is `build`. A web surface usually has
 * a CLIENT to compile, and compiling it is expensive — minutes, on a real app. The
 * recipe's top-level `build` runs before EVERY run; this one runs only when the
 * selected scenarios actually contain a web step, so a repo whose web surface is
 * expensive to build does not pay for it on a cli-only run.
 */
export const RecipeWebSchema = z
  .object({
    /**
     * Shell command run once in the repo root, AFTER the top-level `build`, and only
     * when the run has web steps in it. Omit it when the top-level build already
     * produces the served assets.
     */
    build: z.string().min(1).optional(),
    /** Argv that starts the web surface (resolved like `entry`). The runner sets `PORT`. */
    serve: z.array(z.string()).min(1),
    /** Where the process runs — the api block's rule, verbatim. Defaults to `sandbox`. */
    cwd: z.enum(['sandbox', 'repo']).optional(),
    /** Path polled until it answers 2xx before the first web step. Defaults to `/`. */
    healthPath: z.string().regex(/^\//, 'healthPath must start with /').optional(),
    /** Wall-clock budget for the surface to become ready. Defaults to 60s. */
    readyTimeoutMs: z.number().int().positive().optional(),
    /** Extra env for the web surface process, on top of the recipe-level `env`. */
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict()

/**
 * argv0 basenames (compared case-insensitively) that are shell no-ops — they run
 * nothing and exit 0, so an `entry` built on one executes no program under test.
 * A recipe naming one is the sqlfluff-class defect: every scenario "passes"
 * against `true`, minting bogus findings. Rejected in a proposal and in a
 * hand-written recipe.json alike. Still valid as a no-op `build` (a repo with
 * nothing to compile legitimately builds with `true`).
 */
const NO_OP_ARGV0: ReadonlySet<string> = new Set(['true', 'false', ':', 'test', '[', 'noop'])

/** Whether the entry's argv0 is a shell no-op rather than the program under test. */
export function isNoOpEntry(entry: readonly string[]): boolean {
  const argv0 = entry[0]
  if (!argv0) return false
  return NO_OP_ARGV0.has(path.basename(argv0).toLowerCase())
}

/** The message a rejected no-op entry carries, shared by every schema that gates one. */
export const NO_OP_ENTRY_MESSAGE = 'entry must invoke the program under test, not a shell no-op'

export const RecipeSchema = z
  .object({
    /** Optional shell command run once in the repo root, before every build, to fetch dependencies. */
    install: z.string().min(1).optional(),
    /** Shell command run once in the repo root to produce the entrypoint/server. */
    build: z.string().min(1),
    /** Entrypoint argv (cli driver); scenario `run` argv is appended to this. Repo-relative. */
    entry: z
      .array(z.string())
      .min(1)
      .refine((e) => !isNoOpEntry(e), { message: NO_OP_ENTRY_MESSAGE })
      .optional(),
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
    /**
     * Programs to EXPOSE under their real binary name inside the sandbox:
     * `{ <binName>: <argv | built entry path> }`. The runner writes one shim
     * executable per entry into a directory it prepends to the sandbox PATH, so
     * anything running in the sandbox that invokes the program BY NAME gets the
     * build under test.
     *
     * Without it, a scenario that drives the program through something else —
     * a git hook, a Makefile, another tool's plugin — silently runs whatever copy
     * of the program the machine happens to have (a published release, a stale
     * global install), and every verdict it reaches is about that copy instead of
     * this working tree. That is not a hypothetical: TrueCourse's own pre-commit
     * hook shells out to `truecourse`, so the hook scenarios were grading a
     * published build until this existed.
     *
     * A string value is a path to a built entry (resolved like `entry`); an array
     * is full argv. Both are recipe-owned, so neither is interpolated. No global
     * mutation and no ecosystem assumption: it is a directory on PATH.
     */
    expose: z
      .record(
        z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'a binary name has no path separators'),
        z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
      )
      .optional(),
    /** The api driver's preparation layer; present when the repo has api scenarios. */
    api: RecipeApiSchema.optional(),
    /**
     * The web surface's preparation layer; present when any scenario carries web
     * steps. See {@link RecipeWebSchema}. It is not a third "driver block" beside
     * `entry` and `api`: web steps live inside an ordinary sandbox scenario, so a
     * repo declaring `web` declares an `entry` (or an `api` block) too.
     */
    web: RecipeWebSchema.optional(),
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
export type RecipeApiServer = z.infer<typeof RecipeApiServerSchema>
export type RecipeApi = z.infer<typeof RecipeApiSchema>
export type RecipeWeb = z.infer<typeof RecipeWebSchema>
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
 * ONLY to recognise a value's shape: a credential injected verbatim into
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
 * Shape-check a resolved credential destined for `Authorization`.
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

/** One recipe server with every default applied — the shape the runner boots. */
export interface ResolvedApiServer {
  name: string
  /** Template argv, `${PORT}` unresolved and paths unresolved (see `resolveEntry`). */
  serve: readonly string[]
  cwd: 'sandbox' | 'repo'
  healthPath: string
  readyTimeoutMs: number
  /** `recipe.env` ⊕ `api.env` ⊕ this server's `env`. */
  env: Record<string, string>
  /** The workspace dir this server serves — the route-manifest join key. */
  app?: string
  description?: string
}

/** The recipe's servers by name, plus the one a scenario means when it names none. */
export interface ResolvedApiServers {
  servers: Map<string, ResolvedApiServer>
  defaultServer: string
}

/**
 * Collapse BOTH recipe shapes into ONE map: a legacy `api.serve` yields exactly one
 * server named {@link DEFAULT_API_SERVER_NAME}, and a `servers` map yields itself
 * with the boot defaults applied and the env layers already merged. Nothing
 * downstream ever branches on which shape the recipe was written in — that is the
 * whole point of the seam. A recipe with no `api` block resolves to no servers.
 */
export function resolveApiServers(recipe: Recipe): ResolvedApiServers {
  const api = recipe.api
  const servers = new Map<string, ResolvedApiServer>()
  if (!api) return { servers, defaultServer: DEFAULT_API_SERVER_NAME }
  const shared = { ...(recipe.env ?? {}), ...(api.env ?? {}) }
  if (api.serve) {
    servers.set(DEFAULT_API_SERVER_NAME, {
      name: DEFAULT_API_SERVER_NAME,
      serve: api.serve,
      cwd: api.cwd ?? 'sandbox',
      healthPath: api.healthPath ?? DEFAULT_API_HEALTH_PATH,
      readyTimeoutMs: api.readyTimeoutMs ?? DEFAULT_API_READY_TIMEOUT_MS,
      env: shared,
      ...(api.app ? { app: api.app } : {}),
    })
    return { servers, defaultServer: DEFAULT_API_SERVER_NAME }
  }
  for (const [name, server] of Object.entries(api.servers ?? {})) {
    servers.set(name, {
      name,
      serve: server.serve,
      cwd: server.cwd ?? 'sandbox',
      healthPath: server.healthPath ?? DEFAULT_API_HEALTH_PATH,
      readyTimeoutMs: server.readyTimeoutMs ?? DEFAULT_API_READY_TIMEOUT_MS,
      env: { ...shared, ...(server.env ?? {}) },
      ...(server.app ? { app: server.app } : {}),
      ...(server.description ? { description: server.description } : {}),
    })
  }
  // The schema guarantees `defaultServer` past one server; a lone server is its own
  // default, so a one-entry `servers` map needs no ceremony.
  const defaultServer = api.defaultServer ?? [...servers.keys()][0] ?? DEFAULT_API_SERVER_NAME
  return { servers, defaultServer }
}

/** Default readiness path polled on the booted web surface. */
export const DEFAULT_WEB_HEALTH_PATH = '/'
/**
 * Default budget for the web surface to answer its readiness path. Twice the api
 * default: a web surface commonly boots a framework server that compiles or warms
 * on first request, and the honest failure of a surface that needs 40s is "your
 * scenarios are slow", not "guard says your app is broken".
 */
export const DEFAULT_WEB_READY_TIMEOUT_MS = 60_000

/** The recipe's web surface with every default applied — the shape the runner boots. */
export interface ResolvedWebSurface {
  /** Template argv, `${PORT}` unresolved and paths unresolved (see `resolveEntry`). */
  serve: readonly string[]
  cwd: 'sandbox' | 'repo'
  healthPath: string
  readyTimeoutMs: number
  /** `recipe.env` ⊕ `web.env`. */
  env: Record<string, string>
  /** The extra build command, when the surface declares one. */
  build?: string
}

/**
 * The recipe's web surface with its defaults applied, or `null` when the repo
 * declares none — the ONE place the web block's defaults exist, so the runner, the
 * estimate and any future read surface can never disagree about them.
 */
export function resolveWebSurface(recipe: Recipe): ResolvedWebSurface | null {
  const web = recipe.web
  if (!web) return null
  return {
    serve: web.serve,
    cwd: web.cwd ?? 'sandbox',
    healthPath: web.healthPath ?? DEFAULT_WEB_HEALTH_PATH,
    readyTimeoutMs: web.readyTimeoutMs ?? DEFAULT_WEB_READY_TIMEOUT_MS,
    env: { ...(recipe.env ?? {}), ...(web.env ?? {}) },
    ...(web.build ? { build: web.build } : {}),
  }
}

/**
 * The server a scenario binds to, or an actionable reason it cannot. A scenario
 * naming a server the recipe no longer declares is a PER-SCENARIO error (the
 * recipe was edited under a committed corpus), never a run-wide stop — its
 * siblings still run.
 */
export function resolveScenarioServer(
  scenario: { server?: string },
  resolved: ResolvedApiServers,
): { ok: true; server: ResolvedApiServer } | { ok: false; reason: string } {
  const name = scenario.server ?? resolved.defaultServer
  const server = resolved.servers.get(name)
  if (server) return { ok: true, server }
  return {
    ok: false,
    reason: `scenario binds server "${name}", which recipe.json does not declare (declared: ${[...resolved.servers.keys()].join(', ') || 'none'})`,
  }
}

/**
 * The servers a credential authenticates against: its declared allowlist, or ALL
 * of them when it declares none (the behaviour every pre-multi-server recipe has).
 */
export function credentialServers(
  cred: { servers?: readonly string[] },
  resolved: ResolvedApiServers,
): string[] {
  return cred.servers ? [...cred.servers] : [...resolved.servers.keys()]
}

export interface LoadedRecipe {
  recipe: Recipe
  /** `sha256:…` over the discovery-input files present in the repo. */
  fingerprint: string
}

/**
 * Files whose contents inform recipe discovery; the fingerprint hashes those present.
 *
 * `docker-compose.guard.yml` is the datastore guard GENERATES and the
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
  // The COMMITTED dependency catalog is a recipe-class input: it declares which
  // classes of starting state exist and how a scenario may obtain each one, so
  // declaring a dependency must re-author the sections that used to block on it —
  // exactly what folding `api.externals` into the recipe hash already buys. The
  // gitignored instance overlay is deliberately NOT folded (registering an instance
  // or rotating a key must never re-author anything), and a repo with no catalog
  // hashes exactly as it did before the file existed.
  const dependenciesAbs = dependenciesPath(repoRoot)
  if (fs.existsSync(dependenciesAbs) && fs.statSync(dependenciesAbs).isFile()) {
    hash.update('dependencies.json')
    hash.update('\0')
    hash.update(fs.readFileSync(dependenciesAbs))
    hash.update('\0')
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
 * `api.externals` follows the SAME split, one level deeper: every
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
  forEachInlineSecret(parsed, (holder) => {
    delete holder.value
  })
  return JSON.stringify(canonicalizeJson(parsed))
}

/**
 * Visit every INLINE SECRET a parsed recipe carries — the two `value` fields that
 * hold a literal credential rather than a capability: `api.credentials.<name>.value`
 * and `api.externals.<service>.env.<VAR>.value`. Both treatments of a stored
 * recipe walk THIS list, so a new secret-bearing field leaves the fingerprint and
 * leaves the reader's screen in one edit: {@link hashableRecipeText} deletes what
 * it visits, {@link maskedRecipeText} masks it.
 */
function forEachInlineSecret(parsed: unknown, visit: (holder: Record<string, unknown>) => void): void {
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
          visit(entry as Record<string, unknown>)
        }
      }
    }
  }
  const creds = api?.credentials
  if (creds && typeof creds === 'object') {
    for (const cred of Object.values(creds)) {
      if (cred && typeof cred === 'object' && 'value' in cred) {
        visit(cred as Record<string, unknown>)
      }
    }
  }
}

/**
 * How much of a secret any surface may show: bullets to its length, capped so a
 * long key does not advertise how long it is. The one place the shape of a masked
 * secret is decided — {@link maskRecipeSecret} and `maskStoredSecret` differ only
 * in what they say the value IS, never in how much of it they give away.
 */
export function secretBullets(value: string): string {
  return '•'.repeat(Math.min(value.length, 12))
}

/**
 * ONE inline secret as it may be shown: bullets to the value's length (capped),
 * labelled so it can never be mistaken for the value itself. The single spelling
 * behind every reading of a recipe — the terminal's (`truecourse guard recipe`)
 * and the dashboard's raw JSON — so neither can drift into printing more than
 * the other.
 */
export function maskRecipeSecret(value: string): string {
  return `${secretBullets(value)} (inline value, masked)`
}

/**
 * A stored recipe as a READER may see it: the file's own JSON, pretty-printed,
 * with every inline secret replaced by {@link maskRecipeSecret}. Exactly what the
 * terminal prints — an env-var NAME is a capability and stays, an inline `value`
 * IS the secret and never leaves the file.
 *
 * Everything else is the file's own: key order, and any field no schema knows
 * about (unlike {@link hashableRecipeText}, which canonicalizes for hashing). This
 * is a reading of what is STORED, not a digest input.
 *
 * `null` when the text does not parse as JSON — a file whose secrets cannot be
 * located is never shown, rather than shown unmasked.
 */
export function maskedRecipeText(raw: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  forEachInlineSecret(parsed, (holder) => {
    holder.value = maskRecipeSecret(typeof holder.value === 'string' ? holder.value : '')
  })
  return JSON.stringify(parsed, null, 2)
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
