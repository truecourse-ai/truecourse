/**
 * SERVER BINDING — the join between the route manifest (which workspace app serves
 * which path) and the recipe's declared servers, answering the one question generate
 * asks before it authors an api scenario:
 *
 *   the paths this flow will drive belong to WHICH app, and does the recipe declare
 *   a server for it?
 *
 * The cal.com bench is the failure this exists for: the recipe declared the web app
 * while the docs described `apps/api/v2`, so 30/39 authored scenarios asked the web
 * app for `/v2/...`, got its HTML 404 page, and reported as findings about the app.
 * A documented path with no server must never become a scenario — it must become a
 * visible `blocked-on` gap whose fix is a recipe edit.
 *
 * **The asymmetric contract (R6).** This module may only ever block on a POSITIVE
 * attribution: a path the manifest attributes to a known app that the
 * recipe declares no server for. Everything else — a path that matched nothing, an
 * app whose routes could not be read, a server with no `app` join key — is `unbound`,
 * which authors exactly as guard did before this module existed. A false block is
 * strictly worse than a missed one: it silently deletes coverage.
 *
 * Which makes the manifest's two uncertainty flags mean two different things here:
 *
 *  - `opaque` (a proxying app) — its exact route matches are still safe facts and
 *    do bind. Its PREFIX claim does not: `apps/web` declaring `/api/version` makes
 *    it claim all of `/api/*`, and cal.diy's documented `/api/v1/oauth/token` is a
 *    path the web app neither declares nor rewrites. A proxy's coarse claim says
 *    nothing about ownership, so it is skipped as if nothing matched.
 *  - `pathsShifted` (a Next `basePath`) — the discovered paths are not the app's
 *    real URLs, so even an exact match is a confidently-wrong positive. Such an
 *    app contributes nothing at all: no bind, no block, no foreign-exclusion.
 */

import {
  resolveApiServers,
  whichAppServes,
  canonicalizePath,
  type Recipe,
  type RouteManifest,
  type RouteManifestApp,
} from '@truecourse/guard-runner'
import { parseOperationSection } from './openapi-enrich.js'
import type { SectionInput } from './section-plan.js'

/** The blocked-on noun for a path whose app has no declared server (R4: no new gap kind). */
export const MISSING_SERVER_NOUN = 'missing-server'
/** The blocked-on noun for a flow whose paths span two apps (R2: one server per scenario). */
export const MULTI_SERVER_NOUN = 'multi-server-flow'

/** The recipe's servers, joined to the apps of the route manifest. */
export interface ServerRouteIndex {
  manifest: RouteManifest
  /** App dir (`apps/api/v2`) → the recipe server name that serves it. */
  serverByApp: Map<string, string>
  /** Server name → the app dir it serves, for the servers that name (or imply) one. */
  appByServer: Map<string, string>
}

/** What the paths of one flow say about the server its scenario must run against. */
export type ServerBinding =
  /** Every attributed path belongs to ONE declared server — stamp it on the scenario. */
  | { kind: 'bound'; server: string; app?: RouteManifestApp }
  /** Nothing is positively known ⇒ NEVER a block; author exactly as before. */
  | { kind: 'unbound' }
  /**
   * A known app with no declared server. `alsoBound` names the declared servers the
   * SAME flow also touches — empty means every attributed path belongs to the
   * undeclared app, which is the only case the pre-match gate acts on.
   */
  | { kind: 'missing-server'; app: RouteManifestApp; alsoBound: string[] }
  /** One flow, two declared servers — a scenario runs against exactly one. */
  | { kind: 'spans'; apps: RouteManifestApp[]; servers: string[] }

/**
 * Join the manifest's apps to the recipe's servers. A server's `app` field is the
 * declared join key; when it has none, the serve argv is read for the app's package
 * name or directory (`yarn workspace @calcom/api-v2 start`, `node apps/api/dist/main.js`)
 * — an INFERENCE, so it is dropped whenever it is ambiguous (two servers claiming one
 * app), because a wrong join could block a flow that is perfectly authorable.
 */
export function buildServerRouteIndex(manifest: RouteManifest, recipe: Recipe): ServerRouteIndex {
  const { servers } = resolveApiServers(recipe)
  const serverByApp = new Map<string, string>()
  const appByServer = new Map<string, string>()
  const declaredApps = new Set<string>()
  for (const server of servers.values()) {
    if (!server.app) continue
    const dir = normalizeDir(server.app)
    declaredApps.add(dir)
    appByServer.set(server.name, dir)
    // A dir two servers both declare is ambiguous the same way an inference is.
    if (serverByApp.has(dir)) serverByApp.delete(dir)
    else serverByApp.set(dir, server.name)
  }
  // Inference, only for the servers that declared nothing and only onto apps no
  // server declared: `app` always wins, and a contested app binds to no one.
  const inferred = new Map<string, string[]>()
  for (const server of servers.values()) {
    if (server.app) continue
    for (const app of manifest.apps) {
      if (declaredApps.has(app.dir)) continue
      if (!serveMentionsApp(server.serve, app)) continue
      inferred.set(app.dir, [...(inferred.get(app.dir) ?? []), server.name])
    }
  }
  for (const [dir, names] of inferred) {
    if (names.length !== 1) continue
    if (appByServer.has(names[0])) continue // one server serves one app
    serverByApp.set(dir, names[0])
    appByServer.set(names[0], dir)
  }
  return { manifest, serverByApp, appByServer }
}

/**
 * Decide, from the paths a flow will actually drive, which server its scenario runs
 * against. `missing-server` takes precedence over `spans`: when part of a flow has
 * no server at all, DECLARING that server is the actionable next step, and the
 * "one scenario, one server" verdict only becomes true (and reportable) afterwards.
 */
export function bindFlowServer(paths: readonly string[], index: ServerRouteIndex): ServerBinding {
  const boundServers: string[] = []
  const boundApps = new Map<string, RouteManifestApp>()
  const missingApps = new Map<string, RouteManifestApp>()
  for (const raw of paths) {
    const canonical = canonicalizePath(raw)
    if (canonical === null) continue
    const match = whichAppServes(index.manifest, canonical)
    if (!usableClaim(match)) continue
    const server = index.serverByApp.get(match.app.dir)
    if (server) {
      if (!boundServers.includes(server)) boundServers.push(server)
      boundApps.set(match.app.dir, match.app)
    } else {
      missingApps.set(match.app.dir, match.app)
    }
  }
  const missing = [...missingApps.values()].sort((a, b) => a.dir.localeCompare(b.dir))
  if (missing.length > 0) return { kind: 'missing-server', app: missing[0], alsoBound: boundServers }
  if (boundServers.length > 1) {
    return {
      kind: 'spans',
      apps: [...boundApps.values()].sort((a, b) => a.dir.localeCompare(b.dir)),
      servers: [...boundServers].sort(),
    }
  }
  if (boundServers.length === 1) {
    const app = [...boundApps.values()][0]
    return { kind: 'bound', server: boundServers[0], ...(app ? { app } : {}) }
  }
  return { kind: 'unbound' }
}

/**
 * The blocked-on nouns for an app with no server, mirroring the two-entry
 * `missing-data` pattern: the NOUN makes the class countable across flows, the
 * second entry names exactly what a recipe edit has to add.
 */
export function missingServerBlockedOn(app: RouteManifestApp): string[] {
  return [MISSING_SERVER_NOUN, `${app.dir} — serves ${servedSummary(app)}; recipe.json declares no server for it`]
}

/** The blocked-on nouns for a flow whose paths span two declared servers (R2). */
export function multiServerBlockedOn(apps: readonly RouteManifestApp[]): string[] {
  return [MULTI_SERVER_NOUN, `${apps.map((a) => a.dir).join(' + ')} — a scenario runs against one server`]
}

/**
 * Does the bound app serve this path — or does another app positively claim it?
 * The filter behind the per-server authoring catalog: an operation another service
 * serves must not be offered to a scenario that cannot reach it, and an operation
 * NOBODY claims stays offered (it is only unknown, never foreign).
 */
export function servedByOtherApp(index: ServerRouteIndex, boundApp: string | undefined, requestPath: string): boolean {
  if (!boundApp) return false
  const canonical = canonicalizePath(requestPath)
  if (canonical === null) return false
  const match = whichAppServes(index.manifest, canonical)
  if (!usableClaim(match)) return false
  return match.app.dir !== normalizeDir(boundApp)
}

/** The app one server serves, when the join knows it. */
export function appDirOfServer(index: ServerRouteIndex, server: string | undefined): string | undefined {
  return server ? index.appByServer.get(server) : undefined
}

/**
 * The HTTP paths a flow's bound SECTIONS document — the pre-match gate's evidence,
 * harvested with no LLM call so a flow whose whole documented surface has no server
 * is blocked before authoring is ever paid for. Two readings, both deliberately
 * conservative (a path this misses only means the post-match gate decides instead):
 *
 *  - an OpenAPI operation section states its own mounted path;
 *  - markdown prose states it as `GET /v2/bookings` or inside a `curl` invocation.
 */
export function documentedApiPaths(
  sections: readonly SectionInput[],
  basePaths: ReadonlyMap<string, string>,
): string[] {
  const paths: string[] = []
  for (const section of sections) {
    const op = parseOperationSection(section, basePaths.get(section.doc) ?? '')
    if (op) {
      paths.push(op.basePath ? op.basePath + op.path : op.path)
      continue
    }
    const text = section.fullText || section.ownText
    if (!text) continue
    for (const re of [METHOD_PATH_RE, CURL_URL_RE]) {
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(text)) !== null) {
        const found = m[m.length - 1]
        if (found) paths.push(found)
      }
    }
  }
  return [...new Set(paths)]
}

/** `GET /v2/bookings` in prose — the documented-path form every API doc writes. */
const METHOD_PATH_RE = /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[A-Za-z0-9{}:_\-./]*)/g
/** A `curl` invocation's URL, absolute or path-only. */
const CURL_URL_RE = /curl\b[^\n]*?\s(?:'|")?(https?:\/\/[^\s'"]+|\/[A-Za-z0-9{}:_\-./]*)/g

// --- internals --------------------------------------------------------------

/** One `whichAppServes` answer, narrowed to the claims this module may act on. */
type AppClaim = NonNullable<ReturnType<typeof whichAppServes>>

/**
 * Is this manifest answer a fact strong enough to bind or block on (R6)? Four
 * ways it is not, all of which mean "nothing known" rather than "not served here":
 * nobody claimed the path, the claimant declares no routes at all, the claimant's
 * paths are shifted (its declared URLs are wrong), or — the proxy case — an
 * `opaque` app claimed it by prefix only, which is forwarding, not ownership.
 */
function usableClaim(match: AppClaim | null): match is AppClaim {
  if (!match || match.app.routes.length === 0) return false
  if (match.app.pathsShifted) return false
  return !(match.app.opaque && match.match === 'prefix')
}

/** `./apps/api/v2/` → `apps/api/v2` — the manifest's own dir spelling. */
function normalizeDir(dir: string): string {
  return dir
    .split(/[\\/]/)
    .filter((s) => s !== '' && s !== '.')
    .join('/')
}

/** Does this serve argv name the app's package or its directory? */
function serveMentionsApp(serve: readonly string[], app: RouteManifestApp): boolean {
  for (const token of serve) {
    if (app.pkg && token === app.pkg) return true
    const normalized = normalizeDir(token)
    if (normalized === app.dir || normalized.startsWith(`${app.dir}/`)) return true
  }
  return false
}

/** `/v2/*, /api/*` — what an app's static prefixes say it answers for. */
function servedSummary(app: RouteManifestApp): string {
  if (app.prefixes.length > 0) return app.prefixes.map((p) => `${p}/*`).join(', ')
  return `${app.routes.length} route(s)`
}
