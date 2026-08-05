/**
 * THE LIVE ENDPOINT PROBE — the half of recipe verification that `discoverRecipe`
 * deliberately does not do.
 *
 * Verification proves the server BOOTS and its health path answers 2xx. That is not
 * the same as "the recipe describes a server scenarios can drive": a health endpoint
 * is often the one route mounted before everything else, and a recipe naming the
 * wrong workspace app boots perfectly and 404s every real path (the cal.com failure
 * that multi-server recipes and the route-existence preflight exist for). So setup
 * additionally CALLS one real route per declared server.
 *
 * THE PASS BAR IS DELIBERATELY GENEROUS — **any HTTP status is a pass, 401 and 404
 * included.** A 401 means the route exists and wants auth (which is the seed's job,
 * not the recipe's); a 404 means the route table moved since the manifest was read,
 * which is a spec/route drift question, not a broken recipe. Only three things fail:
 * the boot itself, a thrown fetch (connection refused / timeout), and 5xx on EVERY
 * probed path — which is why up to three REAL routes are sampled, so "everything" is
 * more than one unlucky endpoint. (The health path is not one of them: the boot has
 * already polled it to 2xx, so including it would make the all-5xx verdict
 * unreachable. It is the only sample when nothing else is known.)
 *
 * Path selection reuses the ranking the deterministic proposer already applies to
 * this same route surface (`rankHealthPath`) rather than inventing a second one, and
 * degrades the way the route manifest's asymmetric contract requires (only a POSITIVE
 * attribution may ever count against a repo): a repo whose route manifest knows
 * nothing probes the health path, i.e. exactly the boot check — never a false failure.
 *
 * Nothing here is a WRITE and nothing is fingerprinted: it boots a throwaway sandbox
 * server, makes GET requests, and reports.
 */

import {
  resolveEntry,
  resolveApiServers,
  preflightApiServer,
  buildRouteManifest,
  type Recipe,
  type ResolvedApiServer,
  type RouteManifest,
} from '@truecourse/guard-runner'
import type { GuardSetupServerProbe } from '@truecourse/shared'
import { rankHealthPath, type ApiRouteRef } from './recipe-propose.js'
import { buildServerRouteIndex, appDirOfServer } from './server-binding.js'

/** How long one probe request may take before it counts as a timeout. */
export const PROBE_REQUEST_TIMEOUT_MS = 10_000

export interface ProbeApiServersOptions {
  repoRoot: string
  recipe: Recipe
  /** Injected so a caller that already built one does not walk the tree twice. */
  manifest?: RouteManifest
  signal?: AbortSignal
  /** Test seam — production uses `globalThis.fetch`. */
  fetchImpl?: typeof fetch
  /**
   * Fires once with `0` as soon as the total is known, then again as each server's
   * probe settles — for a live progress line. The opening event is what makes the
   * common single-server case visible at all: one probe boots a server and calls it,
   * which is a minute of silence with nothing but a settle event to show for it.
   *
   * Nothing fires at all when there is nothing to probe: an opening `0/0` with no
   * loop behind it is a progress counter for work that does not exist.
   */
  onServer?: (done: number, total: number) => void
}

/**
 * Boot each declared api server once and call its real routes on it. Returns one
 * result per server, in declaration order. A recipe with no `api` block yields an
 * empty array (a cli-only recipe has nothing to probe) — never a failure.
 */
export async function probeApiServers(opts: ProbeApiServersOptions): Promise<GuardSetupServerProbe[]> {
  const { repoRoot, recipe } = opts
  if (!recipe.api) return []
  const resolved = resolveApiServers(recipe)
  const manifest = opts.manifest ?? buildRouteManifest(repoRoot)
  // The same app-dir join generate's route gates use: declared
  // `api.servers[*].app` first, the serve-argv inference behind it, nothing invented.
  const index = buildServerRouteIndex(manifest, recipe)
  const probes: GuardSetupServerProbe[] = []
  let done = 0
  const total = resolved.servers.size
  // Only when there is work to announce. With `total === 0` the loop below never runs,
  // so nothing would ever replace the opening event — the consumer would paint
  // "probing live routes 0/0" as the running step's phase line and leave it there.
  if (total > 0) opts.onServer?.(done, total)

  for (const server of resolved.servers.values()) {
    const routes = appRoutes(manifest, appDirOfServer(index, server.name))
    const paths = probePaths(server.healthPath, routes)
    probes.push(
      await probeOneServer({
        repoRoot,
        server,
        paths,
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      }),
    )
    opts.onServer?.(++done, total)
  }
  return probes
}

/** The route templates of the app a server serves; empty when the join is unknown. */
function appRoutes(manifest: RouteManifest, appDir: string | undefined): string[] {
  if (!appDir) return []
  return manifest.apps.find((a) => a.dir === appDir)?.routes ?? []
}

/** How many real routes one server is sampled on — enough for "everything", cheap. */
const MAX_PROBE_PATHS = 3

/**
 * The ONE path this server's RESULT is reported for:
 *  1. the best-ranked health endpoint the app's own routes declare (`rankHealthPath`
 *     — the deterministic proposer's ranking, reused verbatim),
 *  2. else the shortest PARAMETER-FREE route the app declares (fewest segments, ties
 *     broken lexicographically, so the choice is stable across runs) — a templated
 *     path is skipped because guessing an id would make the probe's own 404 look
 *     like an app failure,
 *  3. else the server's declared health path — which degrades the probe to exactly
 *     the boot check for a repo the route manifest knows nothing about.
 */
export function pickProbePath(healthPath: string, routes: readonly string[]): string {
  return probePaths(healthPath, routes)[0]
}

/**
 * The paths one server is actually called on: {@link pickProbePath}'s choice plus up
 * to {@link MAX_PROBE_PATHS} - 1 more of the same ranking. Several samples are what
 * make "5xx on EVERYTHING" a real judgement instead of one unlucky endpoint.
 *
 * The health path is NOT among them unless it is all there is: `preflightApiServer`
 * has already polled it to 2xx, so including it would guarantee a passing sample and
 * make the all-5xx verdict unreachable. A repo with no known routes therefore probes
 * exactly the boot check — which is a pass by construction, and correctly so: with
 * nothing known about the route surface there is nothing to be confidently wrong about.
 */
export function probePaths(healthPath: string, routes: readonly string[]): string[] {
  const refs: ApiRouteRef[] = routes.map((path) => ({ method: 'GET', path }))
  const statics = routes
    .filter((r) => !r.includes('{'))
    .sort((a, b) => segmentCount(a) - segmentCount(b) || a.localeCompare(b))
  const ranked = rankHealthPath(refs)
  const ordered = ranked ? [ranked, ...statics.filter((r) => r !== ranked)] : statics
  const picked = [...new Set(ordered)].slice(0, MAX_PROBE_PATHS)
  return picked.length > 0 ? picked : [healthPath]
}

function segmentCount(route: string): number {
  return route.split('/').filter(Boolean).length
}

interface ProbeOneOptions {
  repoRoot: string
  server: ResolvedApiServer
  paths: readonly string[]
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

/** Boot one server through the runner's own preflight and call `paths` on it. */
async function probeOneServer(opts: ProbeOneOptions): Promise<GuardSetupServerProbe> {
  const { repoRoot, server, paths } = opts
  const doFetch: typeof fetch = opts.fetchImpl ?? ((input, init) => fetch(input, init))
  const results: { path: string; status?: number; error?: string }[] = []

  const boot = await preflightApiServer({
    resolvedServe: resolveEntry(repoRoot, server.serve),
    displayServe: server.serve,
    ...(server.cwd === 'repo' ? { cwd: repoRoot } : {}),
    recipeEnv: server.env,
    healthPath: server.healthPath,
    readyTimeoutMs: server.readyTimeoutMs,
    ...(opts.signal ? { signal: opts.signal } : {}),
    onReady: async (baseUrl: string) => {
      for (const path of paths) {
        results.push(await callOnce(doFetch, baseUrl, path))
      }
    },
  })

  if (!boot.ok) {
    return { server: server.name, path: paths[0], ok: false, error: firstLine(boot.stderr) || 'the server did not start' }
  }

  // Report the PICKED path's result (`paths[0]`); the extra samples exist only to
  // make the all-5xx judgement honest, and never become the headline.
  const primary = results.find((r) => r.path === paths[0]) ?? results[0]
  const reachable = results.filter((r) => r.error === undefined)
  if (reachable.length === 0) {
    return {
      server: server.name,
      path: paths[0],
      ok: false,
      error: primary?.error ?? 'nothing answered on the booted server',
    }
  }
  if (reachable.every((r) => (r.status ?? 0) >= 500)) {
    return {
      server: server.name,
      path: paths[0],
      ...(primary?.status !== undefined ? { status: primary.status } : {}),
      ok: false,
      error: `every probed path answered 5xx (${reachable.map((r) => `${r.path} ${r.status}`).join(', ')})`,
    }
  }
  return {
    server: server.name,
    path: paths[0],
    ...(primary?.status !== undefined ? { status: primary.status } : {}),
    ok: true,
  }
}

/** One request, bounded. A thrown fetch (refused / timeout) is a reported error, never a crash. */
async function callOnce(
  doFetch: typeof fetch,
  baseUrl: string,
  path: string,
): Promise<{ path: string; status?: number; error?: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_REQUEST_TIMEOUT_MS)
  try {
    const res = await doFetch(new URL(path, baseUrl), { signal: controller.signal })
    return { path, status: res.status }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return {
      path,
      error: controller.signal.aborted
        ? `${path} did not answer within ${PROBE_REQUEST_TIMEOUT_MS}ms`
        : `${path} was unreachable: ${message}`,
    }
  } finally {
    clearTimeout(timer)
  }
}

function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? ''
}
