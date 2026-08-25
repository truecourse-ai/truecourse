/**
 * The GENERATED datastore — a compose file derived from the app's own connection
 * URL, for the repo that needs a database and ships no compose file.
 *
 * The last manual step on such a repo was "add a docker-compose file with the
 * datastore", the advice discovery's guided datastore message gives. Everything that
 * message asks a human to write is already in the source:
 * `postgres://localhost:5432/weather` names the engine, the port, and the database,
 * and the analyzer's env association names the variable that overrides it. This
 * module turns those literals into a compose file, the `api.services` that runs it,
 * and — when the derivation had to DEVIATE from what the app defaults to — the
 * `api.env` that points the app at what was built.
 *
 * Three rules:
 *
 *  1. **It is pure.** No I/O, no probing (a port collision is verification's to
 *     find, honestly, not propose-time's to guess at), no LLM. Given the same
 *     literals it derives the same file on every machine.
 *  2. **It never invents a secret and never pins a machine-local identity.** A URL
 *     with no user resolves, at RUNTIME, to the OS user — which differs per machine,
 *     so pinning the proposing machine's user into a committed compose file would
 *     break every teammate. The portable answer is an explicit neutral user
 *     ({@link NEUTRAL_USER}) in the compose AND the fully-explicit URL in
 *     `api.env`: deterministic everywhere, and the recipe carries the truth. A URL
 *     that DOES carry credentials is honored verbatim.
 *  3. **It refuses rather than approximates.** An engine with no image mapping, a
 *     connection URL pointing at a remote host, a user with no password where the
 *     image demands one, two different databases of one engine — each returns a
 *     reason, and the caller falls back to that same guided datastore message.
 *
 * The file is written to a DISTINCT name ({@link GUARD_COMPOSE_FILE}) — never
 * `docker-compose.yml`, which is the user's to own.
 */

import yaml from 'js-yaml'
import type { DatastoreUrlRef } from '@truecourse/shared'

/** The generated compose file's name — deliberately not `docker-compose.yml`. */
export const GUARD_COMPOSE_FILE = 'docker-compose.guard.yml'

/**
 * The user a generated container is pinned to when the app's URL names none.
 * Neutral and explicit: the alternative (whatever `whoami` says on the machine
 * that ran discovery) is a per-machine value in a committed file.
 */
export const NEUTRAL_USER = 'guard'

/** One datastore the compose file will declare. */
interface DerivedService {
  /** The compose service key — the canonical engine name. */
  name: string
  spec: Record<string, unknown>
}

/** Everything the proposer needs once a compose file can be derived. */
export interface ComposePlan {
  /** Repo-root-relative file name — {@link GUARD_COMPOSE_FILE}. */
  file: string
  /** The full file text, header comment included. */
  content: string
  /** The recipe's `api.services`, referencing the file by path. */
  services: { up: string; down: string }
  /** Recipe `api.env` entries — EMPTY when the app's own defaults already reach
   *  the generated containers. */
  env: Record<string, string>
  /** Human-facing notes the CLI prints with the recipe's other TODOs. */
  notes: string[]
}

export type ComposeDerivation = { ok: true; plan: ComposePlan } | { ok: false; reason: string }

/** Hosts that mean "the machine guard is running on" — the only ones a generated
 *  container can satisfy. A remote host is someone else's database. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'])

/** How a scheme maps to an engine. Unlisted schemes (`rediss`, `mongodb+srv`, …)
 *  are refused: TLS and hosted-cluster schemes are not a local container. */
const SCHEME_ENGINES: Record<string, string> = {
  postgres: 'postgres',
  postgresql: 'postgres',
  mysql: 'mysql',
  mariadb: 'mariadb',
  mongodb: 'mongodb',
  redis: 'redis',
}

/** The curated images — pinned to a major, alpine where the vendor ships one. */
const ENGINE_IMAGES: Record<string, { image: string; port: number }> = {
  postgres: { image: 'postgres:16-alpine', port: 5432 },
  mysql: { image: 'mysql:8', port: 3306 },
  mariadb: { image: 'mariadb:11', port: 3306 },
  mongodb: { image: 'mongo:7', port: 27017 },
  redis: { image: 'redis:7-alpine', port: 6379 },
}

/** The healthcheck cadence — `up -d --wait` blocks on it, so it has to be brisk
 *  and patient at once: a cold Postgres image is ready in seconds, a cold pull is not. */
const HEALTHCHECK = { interval: '2s', timeout: '5s', retries: 30, start_period: '2s' }

/** One connection URL, parsed into the fields a container is derived from. */
interface Endpoint {
  engine: string
  /** The literal as written — what the app defaults to. */
  url: string
  /** The variable that overrides it, when the source binds one. */
  envVar?: string
  host: string
  port: number
  user: string
  password: string
  database: string
}

/**
 * Derive a compose file (plus its `api.services` / `api.env`) from the connection
 * URLs the app writes down, or explain why not.
 */
export function deriveGuardCompose(refs: readonly DatastoreUrlRef[]): ComposeDerivation {
  const endpoints: Endpoint[] = []
  for (const ref of dedupeByUrl(refs)) {
    const parsed = parseEndpoint(ref)
    // A URL guard could not host is DROPPED, not fatal: a connection string that
    // does not parse, or one pointing at another machine (a deployment default, a
    // fixture double), says nothing about the datastore this repo needs LOCALLY.
    // Only a local URL of an engine with no image is a refusal — that IS the repo's
    // datastore, and guard cannot build it.
    if (parsed.kind === 'skip') continue
    if (parsed.kind === 'refuse') return { ok: false, reason: parsed.reason }
    endpoints.push(parsed.endpoint)
  }
  if (endpoints.length === 0) {
    return { ok: false, reason: 'no local datastore connection URL is written in the source' }
  }

  // Two DIFFERENT databases of one engine would need two containers. The app's own
  // CONFIGURATION is the tiebreak — a URL the source binds an env var to is the one
  // the app reads, and an unbound literal (a test helper's, a comment's example) is
  // not. With no single configured URL it is a refusal: a guess here is a wrong world.
  const byEngine = new Map<string, Endpoint[]>()
  for (const endpoint of endpoints) {
    byEngine.set(endpoint.engine, [...(byEngine.get(endpoint.engine) ?? []), endpoint])
  }
  const chosen: Endpoint[] = []
  for (const engine of [...byEngine.keys()].sort()) {
    const list = byEngine.get(engine)!
    if (list.length === 1) {
      chosen.push(list[0])
      continue
    }
    const configured = list.filter((e) => e.envVar)
    if (configured.length !== 1) {
      return {
        ok: false,
        reason: `the source declares ${list.length} different local ${engine} connection URLs (${list.map((e) => e.url).join(', ')}) and ${configured.length === 0 ? 'binds an environment variable to none of them' : 'binds one to several'} — which one the app under test needs is not deterministic`,
      }
    }
    chosen.push(configured[0])
  }

  const services: DerivedService[] = []
  const env: Record<string, string> = {}
  const notes: string[] = []
  for (const endpoint of chosen) {
    const derived = deriveService(endpoint)
    if (!derived.ok) return derived
    services.push(derived.service)
    // The app's default URL is only good enough when it ALREADY names everything
    // the container was built with. Otherwise the recipe carries the explicit URL —
    // and without a variable to carry it in, there is no honest proposal at all.
    if (derived.explicitUrl !== endpoint.url) {
      if (!endpoint.envVar) {
        return {
          ok: false,
          reason: `the ${endpoint.engine} connection URL \`${endpoint.url}\` needs \`${derived.explicitUrl}\` to reach a generated container, and the source binds no environment variable to it that guard could set`,
        }
      }
      env[endpoint.envVar] = derived.explicitUrl
      notes.push(
        `${GUARD_COMPOSE_FILE} pins the ${endpoint.engine} user to "${NEUTRAL_USER}" (the app's default URL names none, which would resolve to whoever runs it) — the recipe sets ${endpoint.envVar}=${derived.explicitUrl} to match`,
      )
    }
  }

  return {
    ok: true,
    plan: {
      file: GUARD_COMPOSE_FILE,
      content: renderCompose(services, chosen),
      services: {
        up: `docker compose -f ${GUARD_COMPOSE_FILE} up -d --wait`,
        down: `docker compose -f ${GUARD_COMPOSE_FILE} down`,
      },
      env,
      notes,
    },
  }
}

/**
 * Distinct connection URLs, in first-seen order. When the same URL is written both
 * with and without an env binding (a config default and a test helper's copy), the
 * BOUND one wins: the binding is the fact that decides whether the recipe can point
 * the app anywhere, and losing it to source order would be losing information.
 */
function dedupeByUrl(refs: readonly DatastoreUrlRef[]): DatastoreUrlRef[] {
  const byUrl = new Map<string, DatastoreUrlRef>()
  for (const ref of refs) {
    const existing = byUrl.get(ref.url)
    if (!existing) byUrl.set(ref.url, ref)
    else if (!existing.envVar && ref.envVar) byUrl.set(ref.url, ref)
  }
  return [...byUrl.values()]
}

/** One ref → a container's worth of fields, a skip, or a refusal. */
type EndpointParse =
  | { kind: 'endpoint'; endpoint: Endpoint }
  | { kind: 'skip' }
  | { kind: 'refuse'; reason: string }

function parseEndpoint(ref: DatastoreUrlRef): EndpointParse {
  let parsed: URL
  try {
    parsed = new URL(ref.url)
  } catch {
    return { kind: 'skip' }
  }
  const host = parsed.hostname.toLowerCase()
  // Somebody else's machine: not a datastore guard is being asked to provide.
  if (!LOCAL_HOSTS.has(host)) return { kind: 'skip' }
  const engine = SCHEME_ENGINES[ref.scheme.toLowerCase()]
  if (!engine || !ENGINE_IMAGES[engine]) {
    return { kind: 'refuse', reason: `no container image is mapped for the \`${ref.scheme}\` scheme (${ref.url})` }
  }
  return {
    kind: 'endpoint',
    endpoint: {
      engine,
      url: ref.url,
      ...(ref.envVar ? { envVar: ref.envVar } : {}),
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : ENGINE_IMAGES[engine].port,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    },
  }
}

/**
 * One endpoint → its compose service, plus the FULLY EXPLICIT URL that reaches it.
 * The explicit URL is what the recipe will carry when it differs from what the app
 * defaults to; when they are equal the app needs no override at all.
 */
function deriveService(
  endpoint: Endpoint,
): { ok: true; service: DerivedService; explicitUrl: string } | { ok: false; reason: string } {
  const { image, port: containerPort } = ENGINE_IMAGES[endpoint.engine]
  // No `restart:` policy, deliberately: this is a throwaway test datastore that the
  // recipe's `down` disposes of — a container that resurrects itself on reboot is
  // not what anyone asked guard for.
  const base: Record<string, unknown> = {
    image,
    ports: [`${endpoint.port}:${containerPort}`],
  }

  switch (endpoint.engine) {
    case 'postgres': {
      const user = endpoint.user || NEUTRAL_USER
      const environment: Record<string, string> = { POSTGRES_USER: user }
      if (endpoint.database) environment.POSTGRES_DB = endpoint.database
      // A password is never invented: no credentials in the URL ⇒ trust auth, which
      // is what a throwaway, loopback-published test datastore is for.
      if (endpoint.password) environment.POSTGRES_PASSWORD = endpoint.password
      else environment.POSTGRES_HOST_AUTH_METHOD = 'trust'
      return {
        ok: true,
        service: {
          name: 'postgres',
          spec: {
            ...base,
            environment,
            healthcheck: {
              test: ['CMD-SHELL', `pg_isready -U ${user}${endpoint.database ? ` -d ${endpoint.database}` : ''}`],
              ...HEALTHCHECK,
            },
          },
        },
        explicitUrl: rebuildUrl(endpoint, user),
      }
    }
    case 'mysql':
    case 'mariadb': {
      // The mysql/mariadb images REFUSE a `MYSQL_USER` without a password, so a
      // credential-less URL is served by root with an empty password — and a URL
      // that names a user but no password has no honest container at all.
      const user = endpoint.user || 'root'
      if (user !== 'root' && !endpoint.password) {
        return {
          ok: false,
          reason: `the ${endpoint.engine} connection URL \`${endpoint.url}\` names the user "${user}" with no password, and the ${endpoint.engine} image refuses to create a user without one — guard never invents a password`,
        }
      }
      const environment: Record<string, string> = {}
      if (endpoint.database) environment.MYSQL_DATABASE = endpoint.database
      if (user === 'root') {
        if (endpoint.password) environment.MYSQL_ROOT_PASSWORD = endpoint.password
        else environment.MYSQL_ALLOW_EMPTY_PASSWORD = 'yes'
      } else {
        environment.MYSQL_ALLOW_EMPTY_PASSWORD = 'yes'
        environment.MYSQL_USER = user
        environment.MYSQL_PASSWORD = endpoint.password
      }
      return {
        ok: true,
        service: {
          name: endpoint.engine,
          spec: {
            ...base,
            environment,
            healthcheck: { test: ['CMD-SHELL', 'mysqladmin ping -h 127.0.0.1 --silent'], ...HEALTHCHECK },
          },
        },
        explicitUrl: rebuildUrl(endpoint, user),
      }
    }
    case 'mongodb': {
      const environment: Record<string, string> = {}
      if (endpoint.database) environment.MONGO_INITDB_DATABASE = endpoint.database
      if (endpoint.user && endpoint.password) {
        environment.MONGO_INITDB_ROOT_USERNAME = endpoint.user
        environment.MONGO_INITDB_ROOT_PASSWORD = endpoint.password
      } else if (endpoint.user) {
        return {
          ok: false,
          reason: `the mongodb connection URL \`${endpoint.url}\` names the user "${endpoint.user}" with no password — guard never invents one`,
        }
      }
      return {
        ok: true,
        service: {
          name: 'mongodb',
          spec: {
            ...base,
            ...(Object.keys(environment).length > 0 ? { environment } : {}),
            healthcheck: {
              test: ['CMD-SHELL', "mongosh --quiet --eval 'db.adminCommand({ ping: 1 })'"],
              ...HEALTHCHECK,
            },
          },
        },
        // Mongo runs unauthenticated unless the URL asked for credentials, so the
        // app's own URL already reaches it verbatim.
        explicitUrl: endpoint.url,
      }
    }
    case 'redis': {
      if (endpoint.user && endpoint.user !== 'default') {
        return {
          ok: false,
          reason: `the redis connection URL \`${endpoint.url}\` names the ACL user "${endpoint.user}" — guard does not derive a redis ACL configuration`,
        }
      }
      const command = endpoint.password ? ['redis-server', '--requirepass', endpoint.password] : undefined
      return {
        ok: true,
        service: {
          name: 'redis',
          spec: {
            ...base,
            ...(command ? { command } : {}),
            healthcheck: {
              test: ['CMD-SHELL', endpoint.password ? `redis-cli -a ${endpoint.password} ping` : 'redis-cli ping'],
              ...HEALTHCHECK,
            },
          },
        },
        explicitUrl: endpoint.url,
      }
    }
    /* c8 ignore next 2 -- every engine in ENGINE_IMAGES has a case above. */
    default:
      return { ok: false, reason: `no container is derivable for the ${endpoint.engine} engine` }
  }
}

/** The endpoint's URL with `user` made explicit — everything else as written. */
function rebuildUrl(endpoint: Endpoint, user: string): string {
  const scheme = endpoint.url.slice(0, endpoint.url.indexOf('://'))
  const auth = endpoint.password
    ? `${encodeURIComponent(user)}:${encodeURIComponent(endpoint.password)}@`
    : `${encodeURIComponent(user)}@`
  return `${scheme}://${auth}${endpoint.host}:${endpoint.port}${endpoint.database ? `/${endpoint.database}` : ''}`
}

/**
 * The file as it lands on disk: a header saying WHAT it is and WHERE it came from
 * (so a reader never has to ask why an unfamiliar compose file appeared), then the
 * services. It is a normal, editable, committable compose file — guard only ever
 * regenerates it while the recipe does not yet reference it.
 */
function renderCompose(services: readonly DerivedService[], endpoints: readonly Endpoint[]): string {
  const body = yaml.dump(
    {
      // The project NAMESPACE (compose top-level `name:`): without it the file
      // runs under the directory's default project — the developer's own stack,
      // which the static compose-namespace rule refuses (cal.diy 2026-08-21).
      // Derived from the app's own literals to keep this module pure.
      name: projectName(endpoints),
      services: Object.fromEntries(services.map((s) => [s.name, s.spec])),
    },
    { lineWidth: 120, noRefs: true, quotingType: '"' },
  )
  const header = [
    `# ${GUARD_COMPOSE_FILE} — generated by \`truecourse guard\`.`,
    '#',
    '# The datastores this repository needs in order to run, derived from the',
    "# connection URL(s) the app itself declares in its source:",
    ...endpoints.map((e) => `#   ${e.url}${e.envVar ? `  (overridable via ${e.envVar})` : ''}`),
    '#',
    `# The recipe's \`api.services\` runs it (\`docker compose -f ${GUARD_COMPOSE_FILE} up -d --wait\`).`,
    '# It is yours now: review it, edit it, and commit it. Guard regenerates this file',
    '# only while no recipe references it, so your edits are safe.',
    '#',
    '# It is NOT a deployment artifact — it publishes a throwaway datastore on',
    '# localhost for tests to run against.',
    '',
  ].join('\n')
  return `${header}\n${body}`
}

/** `tc-guard-<database>` (first named database, else the first engine), squeezed
 *  into compose's project-name alphabet. Deterministic from the same literals the
 *  rest of the file is derived from. */
function projectName(endpoints: readonly Endpoint[]): string {
  const seed = endpoints.find((e) => e.database)?.database ?? endpoints[0]?.engine ?? 'datastore'
  const squeezed = seed.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '')
  return `tc-guard-${squeezed || 'datastore'}`
}
