/**
 * The ROUTE MANIFEST — which workspace app serves which HTTP path, derived from
 * the working tree alone. It exists to answer one question two stages
 * ask independently:
 *
 *   generate: this documented path belongs to an app the recipe declares no
 *             server for — block the flow instead of authoring a scenario that
 *             asks the wrong service and reports a false failure.
 *   run:      the bound server answered 404 for a path another app serves —
 *             that is infrastructure (`error`), not a spec/code disagreement.
 *
 * It lives in guard-runner because that is the one package both `guard-generator`
 * and the runner already depend on, and it must stay as cheap as the runner is:
 * pure FS + regex, no analyzer, no LLM, no build, nothing persisted, nothing
 * fingerprinted. Rebuilding it is a directory walk.
 *
 * **The asymmetric contract (R6).** Every heuristic here is allowed to say
 * "nothing known"; none of them is allowed to be confidently wrong. A path that
 * matches nothing, or an app whose routes could not be read, degrades to the
 * behaviour guard had before this module existed. The manifest may only ever
 * *positively* attribute a path to an app; callers must treat everything else as
 * unknown. Uncertainty comes in two flavours a caller has to tell apart:
 *
 *   `opaque`       — the app may serve MORE than it declares (a proxy, an
 *                    unreadable framework, a capped walk). What it DOES declare is
 *                    still true, so an exact template match on it is actionable;
 *                    its coarse {@link staticPrefixes} claim is not, since a proxy
 *                    can hold a prefix over paths it only forwards.
 *   `pathsShifted` — the declared paths are themselves wrong (a Next `basePath`
 *                    remounts them all). Nothing from such an app is usable.
 */

import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { DOC_DISCOVERY_SKIP_DIRS } from '@truecourse/shared'

/** One workspace app and the HTTP surface it declares. */
export interface RouteManifestApp {
  /** Repo-relative dir, e.g. `apps/api/v2`. The join key to `api.servers[*].app`. */
  dir: string
  /** package.json name, when there is one (`@calcom/api-v2`). */
  pkg?: string
  framework: 'next' | 'nest' | 'remix' | 'other'
  /** Canonical path templates (`/v2/bookings/{id}`), sorted, deduped. */
  routes: string[]
  /** Static 1- and 2-segment prefixes covering the routes (`/v2`, `/api/v2`). Reporting only. */
  prefixes: string[]
  /**
   * True when the app may serve MORE than it declares (a Next.js `rewrites()`/
   * `proxy`/`basePath` was detected, a framework whose routes could not be read,
   * or a tree too large to walk). The routes it DID declare are still facts — an
   * exact template match on an opaque app is safe to act on; a coarse
   * {@link staticPrefixes} claim is not, because a proxy's prefix may cover paths
   * it merely forwards. Callers that block must degrade on the prefix case.
   */
  opaque: boolean
  /**
   * True when the discovered routes are not the app's real URLs — today the one
   * cause is a Next.js `basePath`, which mounts EVERY route under a prefix this
   * module does not read. It is a strictly stronger statement than {@link opaque}
   * ("may serve more") and gets its own flag rather than a reason enum because
   * that is exactly the one question a caller has to ask: an opaque app's positive
   * routes are usable, a shifted app's are confidently wrong, so a shifted app
   * must contribute NOTHING — no attribution, no block, no foreign-exclusion (R6).
   * Always accompanied by `opaque: true`.
   */
  pathsShifted: boolean
}

export interface RouteManifest {
  apps: RouteManifestApp[]
}

export interface BuildRouteManifestOptions {
  /**
   * Extra (path, absolute file) pairs from an analyzer pass, attributed to apps by
   * file path — `interface.service.ts` can feed `FileAnalysis.routeRegistrations`.
   * A pair whose file lands under no discovered app is dropped (never invented).
   */
  extraRoutes?: readonly { path: string; file: string }[]
}

/** Per-app file budget; a tree bigger than this is `opaque` rather than half-read. */
const MAX_FILES_PER_APP = 2000

/** How deep below a workspace glob match a `package.json` is still an app of its own. */
const APP_NESTING_DEPTH = 3

/** How deep a route walk descends inside one app before giving up. */
const MAX_ROUTE_DEPTH = 12

const ROUTE_FILE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

/**
 * Derive the manifest for `repoRoot`. Never throws: an unreadable directory, a
 * malformed manifest, or a framework nobody recognises yields fewer facts, never
 * a failure — a caller that gets an empty manifest behaves exactly as it did
 * before route awareness existed.
 */
export function buildRouteManifest(repoRoot: string, opts: BuildRouteManifestOptions = {}): RouteManifest {
  const apps: RouteManifestApp[] = []
  for (const dir of discoverAppDirs(repoRoot)) {
    const app = readApp(repoRoot, dir)
    if (app) apps.push(app)
  }
  // Analyzer-supplied routes are attributed by FILE PATH: the deepest app dir
  // containing the file owns the route (an app nested under another wins).
  for (const extra of opts.extraRoutes ?? []) {
    const owner = ownerOf(apps, path.relative(repoRoot, extra.file))
    if (!owner) continue
    const canonical = canonicalizePath(extra.path)
    if (canonical) owner.routes.push(canonical)
  }
  for (const app of apps) {
    app.routes = [...new Set(app.routes)].sort()
    app.prefixes = staticPrefixes(app.routes)
  }
  apps.sort((a, b) => a.dir.localeCompare(b.dir))
  return { apps }
}

/**
 * Which app serves `path`? `null` = nothing in the manifest claims it, which is
 * NEVER a block (R6). An exact template match always beats a prefix match, and
 * within each class the most specific claim wins (most static segments / longest
 * prefix), ties broken by dir so the answer is stable.
 *
 * An `opaque` or `pathsShifted` app can still be returned — it is the caller's job
 * to degrade on those flags, because "this app claims the path but may also
 * forward others" and "this app's declared paths are shifted" are both different
 * facts from "nobody claims it". The `match` kind is what makes that possible: a
 * `route` match is an exact template the app declares, a `prefix` match is only
 * the coarse claim derived from those templates.
 */
export function whichAppServes(
  manifest: RouteManifest,
  requestPath: string,
): { app: RouteManifestApp; match: 'route' | 'prefix' } | null {
  const segs = pathSegments(requestPath)
  if (segs === null) return null

  let best: { app: RouteManifestApp; score: number } | null = null
  for (const app of manifest.apps) {
    for (const route of app.routes) {
      if (!templateMatches(route, segs)) continue
      const score = staticSegmentCount(route)
      if (!best || score > best.score) best = { app, score }
    }
  }
  if (best) return { app: best.app, match: 'route' }

  let bestPrefix: { app: RouteManifestApp; length: number } | null = null
  for (const app of manifest.apps) {
    for (const prefix of app.prefixes) {
      const prefixSegs = prefix.split('/').filter(Boolean)
      if (prefixSegs.length > segs.length) continue
      if (!prefixSegs.every((s, i) => s === segs[i])) continue
      if (!bestPrefix || prefixSegs.length > bestPrefix.length) {
        bestPrefix = { app, length: prefixSegs.length }
      }
    }
  }
  return bestPrefix ? { app: bestPrefix.app, match: 'prefix' } : null
}

// --- App discovery ----------------------------------------------------------

/**
 * The workspace app directories, repo-relative: the root manifest's own workspace
 * globs first (`package.json.workspaces`, `pnpm-workspace.yaml.packages`), and —
 * only when the repo declares none — the three conventional homes. A glob match
 * that is itself not a package (cal.com's `apps/api`, a folder of packages)
 * descends a bounded distance looking for the packages inside it.
 *
 * Exported as {@link workspacePackageDirs} for callers that want the package
 * inventory itself rather than the HTTP surface built on top of it (recipe
 * discovery reads it to find the workspace member that declares the cli).
 */
export function workspacePackageDirs(repoRoot: string): string[] {
  return discoverAppDirs(repoRoot)
}

function discoverAppDirs(repoRoot: string): string[] {
  const globs = workspaceGlobs(repoRoot)
  const patterns = globs.length > 0 ? globs : ['apps/*', 'packages/*', 'services/*']
  const dirs = new Set<string>()
  for (const pattern of patterns) {
    for (const dir of expandGlob(repoRoot, pattern)) {
      for (const pkgDir of packagesUnder(repoRoot, dir, APP_NESTING_DEPTH)) dirs.add(pkgDir)
    }
  }
  return [...dirs].sort()
}

/** The workspace globs the repo declares, from either package manager's manifest. */
function workspaceGlobs(repoRoot: string): string[] {
  const globs: string[] = []
  const pkg = readJson(path.join(repoRoot, 'package.json'))
  const workspaces = (pkg as { workspaces?: unknown } | null)?.workspaces
  if (Array.isArray(workspaces)) {
    for (const g of workspaces) if (typeof g === 'string') globs.push(g)
  } else if (workspaces && typeof workspaces === 'object' && Array.isArray((workspaces as { packages?: unknown }).packages)) {
    for (const g of (workspaces as { packages: unknown[] }).packages) if (typeof g === 'string') globs.push(g)
  }
  try {
    const wsFile = path.join(repoRoot, 'pnpm-workspace.yaml')
    if (fs.existsSync(wsFile)) {
      const parsed = yaml.load(fs.readFileSync(wsFile, 'utf-8'))
      const packages = (parsed as { packages?: unknown } | null)?.packages
      if (Array.isArray(packages)) {
        for (const g of packages) if (typeof g === 'string') globs.push(g)
      }
    }
  } catch {
    // A workspace file we cannot read simply contributes no globs.
  }
  // A negation glob excludes; this module has no need for that precision — it
  // would only ever ADD apps, and an extra app can never cause a false block.
  return [...new Set(globs.filter((g) => !g.startsWith('!')))]
}

/** Expand one workspace glob (`apps/*`, `packages/**`) into existing directories. */
function expandGlob(repoRoot: string, pattern: string): string[] {
  const segments = pattern.split('/').filter((s) => s !== '' && s !== '.')
  let current = ['']
  for (const segment of segments) {
    const next: string[] = []
    for (const base of current) {
      const abs = path.join(repoRoot, base)
      if (segment === '**') {
        // `**` is treated as "here, or any directory below, bounded" — the bound is
        // what keeps this a directory listing rather than a repo crawl.
        next.push(base, ...descendants(repoRoot, base, APP_NESTING_DEPTH))
        continue
      }
      if (!segment.includes('*')) {
        if (isDir(path.join(abs, segment))) next.push(base ? `${base}/${segment}` : segment)
        continue
      }
      const re = globSegmentRegex(segment)
      for (const entry of readDirs(abs)) {
        if (re.test(entry)) next.push(base ? `${base}/${entry}` : entry)
      }
    }
    current = [...new Set(next)]
  }
  return current.filter((d) => d !== '' && isDir(path.join(repoRoot, d)))
}

function globSegmentRegex(segment: string): RegExp {
  const escaped = segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
  return new RegExp(`^${escaped}$`)
}

/** Directory paths below `base`, bounded by `depth`, skipping build/vendor dirs. */
function descendants(repoRoot: string, base: string, depth: number): string[] {
  if (depth <= 0) return []
  const out: string[] = []
  for (const entry of readDirs(path.join(repoRoot, base))) {
    const rel = base ? `${base}/${entry}` : entry
    out.push(rel, ...descendants(repoRoot, rel, depth - 1))
  }
  return out
}

/** `dir` itself when it is a package, else the packages a bounded walk finds inside. */
function packagesUnder(repoRoot: string, dir: string, depth: number): string[] {
  if (fs.existsSync(path.join(repoRoot, dir, 'package.json'))) return [dir]
  if (depth <= 0) return []
  const out: string[] = []
  for (const entry of readDirs(path.join(repoRoot, dir))) {
    out.push(...packagesUnder(repoRoot, `${dir}/${entry}`, depth - 1))
  }
  return out
}

/** The deepest app whose dir contains `relFile`, or null. */
function ownerOf(apps: RouteManifestApp[], relFile: string): RouteManifestApp | null {
  const normalized = relFile.split(path.sep).join('/')
  let best: RouteManifestApp | null = null
  for (const app of apps) {
    if (normalized === app.dir || normalized.startsWith(`${app.dir}/`)) {
      if (!best || app.dir.length > best.dir.length) best = app
    }
  }
  return best
}

// --- Per-app route extraction ----------------------------------------------

/** Read one app dir into its manifest entry, or null when it is not a package. */
function readApp(repoRoot: string, dir: string): RouteManifestApp | null {
  const abs = path.join(repoRoot, dir)
  const pkg = readJson(path.join(abs, 'package.json')) as
    | { name?: unknown; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    | null
  if (!pkg) return null
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
  const nextConfig = findFile(abs, (f) => f.startsWith('next.config.'))
  const remixDeps = Object.keys(deps).some(
    (d) => d.startsWith('@remix-run/') || d === 'react-router' || d.startsWith('@react-router/'),
  )
  const framework: RouteManifestApp['framework'] =
    'next' in deps || nextConfig !== null
      ? 'next'
      : '@nestjs/core' in deps
        ? 'nest'
        : remixDeps
          ? 'remix'
          : 'other'

  const app: RouteManifestApp = {
    dir,
    ...(typeof pkg.name === 'string' && pkg.name ? { pkg: pkg.name } : {}),
    framework,
    routes: [],
    prefixes: [],
    opaque: false,
    pathsShifted: false,
  }

  const budget = { files: 0 }
  if (framework === 'next') {
    // A `rewrites()`/`proxy`/`basePath` next.config means the app can answer for
    // paths it never declares — the safety valve that keeps a proxying frontend
    // from ever being told it does not serve something. `basePath` says more than
    // that: it moves every route under a prefix, so the paths read off the tree are
    // not the app's URLs at all and must stop being facts.
    const configText = nextConfig !== null ? readText(nextConfig) : ''
    if (/\brewrites\b|\bproxy\b|\bbasePath\b/.test(configText)) {
      app.opaque = true
    }
    if (/\bbasePath\b/.test(configText)) {
      app.pathsShifted = true
    }
    app.routes.push(...nextRoutes(abs, budget))
  } else if (framework === 'nest') {
    const controllers = collectFiles(abs, (f) => f.endsWith('.controller.ts'), budget)
    // A Nest app with no controller file is one whose routes we simply could not
    // read (a generated surface, an unusual layout) — never "it serves nothing".
    if (controllers.length === 0) app.opaque = true
    app.routes.push(...nestRoutes(abs, controllers, budget))
  } else if (framework === 'remix') {
    // Only the flat-routes convention is readable from filenames alone; a
    // config-file route table is opaque — never "it serves nothing". Before this
    // branch existed, a Remix product app read as `other · (no routes detected)`
    // and the recipe briefing pointed the model at the DOCS site instead
    // (documenso, 2026-08-20 bench).
    const routes = remixRoutes(abs, budget)
    if (routes === null) app.opaque = true
    else app.routes.push(...routes)
  }
  if (budget.files > MAX_FILES_PER_APP) app.opaque = true
  return app
}

// --- Next.js ----------------------------------------------------------------

/** Both Next routers' surfaces: the `pages/api` tree, and every `route.*` file
 *  under the `app` tree. */
function nextRoutes(appAbs: string, budget: { files: number }): string[] {
  const routes: string[] = []
  for (const base of ['pages/api', 'src/pages/api']) {
    const root = path.join(appAbs, base)
    if (!isDir(root)) continue
    for (const rel of walkFiles(root, budget)) {
      if (!ROUTE_FILE_EXTS.includes(path.extname(rel))) continue
      const withoutExt = rel.slice(0, -path.extname(rel).length)
      const segs = withoutExt.split('/').filter(Boolean)
      if (segs[segs.length - 1] === 'index') segs.pop()
      const template = canonicalizePath(`/api/${segs.map(nextSegment).filter(Boolean).join('/')}`)
      if (template) routes.push(template)
    }
  }
  for (const base of ['app', 'src/app']) {
    const root = path.join(appAbs, base)
    if (!isDir(root)) continue
    for (const rel of walkFiles(root, budget)) {
      const name = path.basename(rel)
      if (!ROUTE_FILE_EXTS.some((ext) => name === `route${ext}`)) continue
      const segs = path
        .dirname(rel)
        .split('/')
        .filter((s) => s !== '' && s !== '.')
        // Route groups `(marketing)` and parallel slots `@modal` are organizational
        // only — they never appear in the URL.
        .filter((s) => !(s.startsWith('(') && s.endsWith(')')) && !s.startsWith('@'))
        .map(nextSegment)
      const template = canonicalizePath(`/${segs.filter(Boolean).join('/')}`)
      if (template) routes.push(template)
    }
  }
  return routes
}

/** `[id]` → `{id}`, `[...slug]` / `[[...slug]]` → `{...slug}`, else verbatim. */
function nextSegment(segment: string): string {
  const optionalCatchAll = /^\[\[\.\.\.(.+)\]\]$/.exec(segment)
  if (optionalCatchAll) return `{...${optionalCatchAll[1]}}`
  const catchAll = /^\[\.\.\.(.+)\]$/.exec(segment)
  if (catchAll) return `{...${catchAll[1]}}`
  const dynamic = /^\[(.+)\]$/.exec(segment)
  if (dynamic) return `{${dynamic[1]}}`
  return segment
}

// --- Remix / React Router (flat routes) ---------------------------------------
//
// The whole address lives in the file's NAME under `app/routes/`, `.`-separated
// (`t.$teamUrl+/documents.$id.edit.tsx` → /t/{teamUrl}/documents/{id}/edit). The
// grammar is remix-flat-routes' own, read token by token. THE GATE: `routes/` is
// far too common a directory name to read on sight, so the tree only counts when
// the app's own routes config imports `remix-flat-routes`. Ungated or
// config-table routing returns null — opaque, never "serves nothing".

const REMIX_ROUTES_CONFIG = /^routes\.(?:tsx|jsx|ts|js|mjs)$/
const REMIX_ROUTE_FILE = /\.(?:tsx|jsx|ts|js|mjs)$/

/** Route templates of a flat-routes app, or null when the tree is unreadable. */
function remixRoutes(appAbs: string, budget: { files: number }): string[] | null {
  for (const base of ['app', 'src/app']) {
    const appDir = path.join(appAbs, base)
    const config = isDir(appDir)
      ? fs.readdirSync(appDir).find((f) => REMIX_ROUTES_CONFIG.test(f))
      : undefined
    if (!config) continue
    budget.files += 1
    if (!readText(path.join(appDir, config)).includes('remix-flat-routes')) continue
    const routesDir = path.join(appDir, 'routes')
    if (!isDir(routesDir)) continue
    const routes: string[] = []
    for (const rel of walkFiles(routesDir, budget)) {
      const segments = remixRouteSegments(rel.split('/'))
      if (segments === null) continue
      const template = canonicalizePath(`/${segments.join('/')}`)
      if (template) routes.push(template)
    }
    return routes
  }
  return null
}

/** The address segments of one route module, or null when the file is not a
 *  route: a layout, a splat, or a file colocated in a non-`+` directory. */
function remixRouteSegments(relative: string[]): string[] | null {
  const fileName = relative[relative.length - 1]
  if (!fileName || !REMIX_ROUTE_FILE.test(fileName)) return null

  const tokens: string[] = []
  for (const directory of relative.slice(0, -1)) {
    if (!directory.endsWith('+')) return null // colocation, not routing
    tokens.push(...remixSplit(directory.slice(0, -1)))
  }
  tokens.push(...remixSplit(fileName.replace(REMIX_ROUTE_FILE, '')))

  const segments: string[] = []
  for (const [index, token] of tokens.entries()) {
    const last = index === tokens.length - 1
    if (token === 'layout' || token === '_layout') return null // the layout module itself
    if (token === '$') return null // a splat catches what no place matched
    if (last && (token === 'route' || token === 'index' || token === 'page')) continue
    if (token.startsWith('_')) continue // pathless: a layout wrap, or the index route
    const escaped = /^\[(.*)\]$/.exec(token)
    if (escaped) {
      segments.push(escaped[1]!)
      continue
    }
    const trimmed = token.endsWith('_') ? token.slice(0, -1) : token
    segments.push(trimmed.startsWith('$') ? `{${trimmed.slice(1)}}` : trimmed)
  }
  return segments
}

/** Split one name on the separator dots, leaving the `[…]`-escaped ones alone. */
function remixSplit(name: string): string[] {
  const tokens: string[] = []
  let current = ''
  let escaped = false
  for (const char of name) {
    if (char === '[') escaped = true
    else if (char === ']') escaped = false
    if (char === '.' && !escaped) {
      if (current) tokens.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

// --- NestJS -----------------------------------------------------------------

const CONTROLLER_RE = /@Controller\(\s*(?:\{[^}]*path\s*:\s*)?['"]([^'"]*)['"]/
const METHOD_RE = /@(Get|Post|Put|Patch|Delete|Head|Options|All)\(\s*(?:['"]([^'"]*)['"])?/g
const GLOBAL_PREFIX_RE = /setGlobalPrefix\(\s*['"]([^'"]+)['"]/
const DEFAULT_VERSION_RE = /defaultVersion\s*:\s*['"]([^'"]+)['"]/

/**
 * Compose `globalPrefix + version + controller + method` for every decorated
 * handler in the app's controllers. Deliberately regex-level: a Nest controller
 * declares its path as a string literal in a decorator, which is exactly what a
 * regex reads reliably — anything cleverer would need the TS compiler, which this
 * module must not pull in.
 */
function nestRoutes(appAbs: string, controllers: string[], budget: { files: number }): string[] {
  const bootstrap = nestBootstrapPrefix(appAbs, budget)
  const routes: string[] = []
  for (const file of controllers) {
    const text = readText(file)
    const controllerPath = CONTROLLER_RE.exec(text)?.[1] ?? ''
    METHOD_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = METHOD_RE.exec(text)) !== null) {
      const template = canonicalizePath([bootstrap, controllerPath, m[2] ?? ''].join('/'))
      if (template) routes.push(template)
    }
  }
  return routes
}

/** The `setGlobalPrefix` / `defaultVersion` prefix the app's bootstrap applies. */
function nestBootstrapPrefix(appAbs: string, budget: { files: number }): string {
  const parts: string[] = []
  for (const rel of ['src/main.ts', 'main.ts', 'src/bootstrap.ts', 'bootstrap.ts', 'src/app.ts']) {
    const abs = path.join(appAbs, rel)
    if (!fs.existsSync(abs)) continue
    budget.files += 1
    const text = readText(abs)
    const prefix = GLOBAL_PREFIX_RE.exec(text)?.[1]
    if (prefix) parts.push(prefix)
    const version = DEFAULT_VERSION_RE.exec(text)?.[1]
    if (version) parts.push(version.startsWith('v') ? version : `v${version}`)
    if (parts.length > 0) break
  }
  return parts.join('/')
}

// --- Path canonicalization + matching ---------------------------------------

/**
 * One canonical path template: leading slash, no trailing slash, no duplicate
 * separators, `:id` normalized to `{id}`, query string dropped. Returns `null`
 * for anything that is not a path (an absolute URL, an empty string) so a caller
 * never records a route it cannot match against.
 */
export function canonicalizePath(raw: string): string | null {
  if (typeof raw !== 'string') return null
  let value = raw.trim()
  if (value === '') return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      value = new URL(value).pathname
    } catch {
      return null
    }
  }
  value = value.split('?')[0].split('#')[0]
  const segs = value
    .split('/')
    .filter((s) => s !== '' && s !== '.')
    .map((s) => (s.startsWith(':') ? `{${s.slice(1)}}` : s))
  if (segs.length === 0) return '/'
  return `/${segs.join('/')}`
}

/** The path's segments, or null when it is not a usable path. */
function pathSegments(requestPath: string): string[] | null {
  const canonical = canonicalizePath(requestPath)
  if (canonical === null) return null
  return canonical.split('/').filter(Boolean)
}

/** Segment-wise template match: `{x}` takes one segment, `{...x}` takes the rest. */
function templateMatches(template: string, segs: readonly string[]): boolean {
  const parts = template.split('/').filter(Boolean)
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (part.startsWith('{...')) return true
    if (i >= segs.length) return false
    if (part.startsWith('{') && part.endsWith('}')) continue
    if (part !== segs[i]) return false
  }
  return parts.length === segs.length
}

function staticSegmentCount(template: string): number {
  return template.split('/').filter((s) => s !== '' && !s.startsWith('{')).length
}

/**
 * The static 1- and 2-segment prefixes covering `routes` — what a report says
 * ("serves /v2/*") and the coarse claim `whichAppServes` falls back to when no
 * template matches exactly. A route whose FIRST segment is dynamic contributes
 * no prefix: `/{tenant}/x` claims everything, which is never a safe claim.
 */
function staticPrefixes(routes: readonly string[]): string[] {
  const prefixes = new Set<string>()
  for (const route of routes) {
    const segs = route.split('/').filter(Boolean)
    if (segs.length === 0 || segs[0].startsWith('{')) continue
    prefixes.add(`/${segs[0]}`)
    if (segs.length > 1 && !segs[1].startsWith('{')) prefixes.add(`/${segs[0]}/${segs[1]}`)
  }
  return [...prefixes].sort()
}

// --- Bounded FS helpers -----------------------------------------------------

function isDir(abs: string): boolean {
  try {
    return fs.statSync(abs).isDirectory()
  } catch {
    return false
  }
}

function readDirs(abs: string): string[] {
  try {
    return fs
      .readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !DOC_DISCOVERY_SKIP_DIRS.has(e.name))
      .map((e) => e.name)
  } catch {
    return []
  }
}

function readJson(abs: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf-8'))
  } catch {
    return null
  }
}

function readText(abs: string): string {
  try {
    return fs.readFileSync(abs, 'utf-8')
  } catch {
    return ''
  }
}

/** The first top-level file of `abs` matching `pred` (absolute), or null. */
function findFile(abs: string, pred: (name: string) => boolean): string | null {
  try {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.isFile() && pred(entry.name)) return path.join(abs, entry.name)
    }
  } catch {
    // unreadable dir → no file
  }
  return null
}

/** Every file under `root`, as `/`-joined paths relative to it, budget-capped. */
function walkFiles(root: string, budget: { files: number }, depth = 0): string[] {
  if (depth > MAX_ROUTE_DEPTH || budget.files > MAX_FILES_PER_APP) return []
  const out: string[] = []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || DOC_DISCOVERY_SKIP_DIRS.has(entry.name)) continue
    if (entry.isDirectory()) {
      for (const rel of walkFiles(path.join(root, entry.name), budget, depth + 1)) {
        out.push(`${entry.name}/${rel}`)
      }
    } else if (entry.isFile()) {
      budget.files += 1
      if (budget.files > MAX_FILES_PER_APP) return out
      out.push(entry.name)
    }
  }
  return out
}

/** Absolute paths of the files under `abs` whose name matches `pred`, budget-capped. */
function collectFiles(abs: string, pred: (name: string) => boolean, budget: { files: number }): string[] {
  return walkFiles(abs, budget)
    .filter((rel) => pred(path.basename(rel)))
    .map((rel) => path.join(abs, rel))
}
