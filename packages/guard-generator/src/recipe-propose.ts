/**
 * The DETERMINISTIC recipe proposer — recipe discovery's first pass, and the one
 * that costs nothing. It reads the repository's own declarations (manifest files,
 * lockfiles, scripts, the derived route surface, the OpenAPI security schemes) and
 * assembles a complete `recipe.json`-shaped object; the LLM proposer is the
 * FALLBACK, reached only when this module refuses to decide.
 *
 * Two rules shape every detector here:
 *  1. **A wrong recipe is worse than an LLM call.** Anything ambiguous — two
 *     ecosystems, a workspace monorepo, two FastAPI apps, three csproj files, a
 *     `start` script that is really a watcher — BAILS with a reason instead of
 *     guessing. The caller falls through to the model.
 *  2. **It proposes; it never verifies.** Everything this module returns goes
 *     through the SAME `verifyProposal` (install → build → boot/probe) the model's
 *     proposals go through, and nothing is written until that passes.
 *
 * One thing it does beyond reading: for a repo that NEEDS a datastore and ships no
 * compose file, it derives one from the app's own connection URL (see
 * `datastore-compose.ts`). Derives, not writes — the file rides out as part of the
 * proposal and the caller writes it before verification, so rule 2 still holds.
 *
 * It produces a full {@link Recipe} rather than the model-facing `RecipeProposal`:
 * the deterministic path can fill fields the model is never allowed to
 * (`api.services`, `api.credentials`), so it targets the runner's own schema
 * directly and validates against it.
 *
 * Credential stubs are STUBS: `valueFromEnv` names a variable the user must set,
 * and the fill-in is reported as a TODO. The recipe still VERIFIES (booting and
 * health-checking a server needs no auth) — the run is what stops, loudly, on the
 * unset variable. A secret is never fabricated.
 */

import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import {
  isOpenApiDoc,
  recipePath,
  workspacePackageDirs,
  RecipeSchema,
  type Recipe,
  type RecipeApiCredential,
  type RouteManifestApp,
} from '@truecourse/guard-runner'
import { parseOpenApiSpec, parseSecuritySchemes, type SecurityScheme } from '@truecourse/shared/openapi'
import type { DatastoreUrlRef, Interface } from '@truecourse/shared'
import { deriveGuardCompose, GUARD_COMPOSE_FILE, type ComposePlan } from './datastore-compose.js'

/** One operation of the derived api surface — all the health ranking needs. */
export interface ApiRouteRef {
  method: string
  path: string
}

/** The ecosystems the deterministic path can read. */
export type RecipeEcosystem = 'js' | 'python' | 'dotnet'

/** What the proposer was given beyond the repo itself. Both are optional: a
 *  missing route surface only costs the health path, missing schemes only the
 *  credential stubs. */
export interface ProposeRecipeInputs {
  /** The derived api route surface (route registrations ∪ OpenAPI operations). */
  routes?: readonly ApiRouteRef[]
  /** OpenAPI security schemes; defaults to the ones declared by the corpus's docs. */
  securitySchemes?: Record<string, SecurityScheme>
  /**
   * The datastore connection URLs the app writes down, off the analyzer.
   * Used ONLY when the repo declares no compose datastore of its own: the proposer
   * then derives a compose file from them so a database-backed repo needs no manual
   * step at all. Absent ⇒ nothing is generated, exactly as before.
   */
  datastores?: readonly DatastoreUrlRef[]
  /**
   * The route manifest's workspace apps — what lets the WORKSPACE branch derive
   * an api proposal at all. Before this a monorepo either shipped exactly one
   * `bin`-declaring member (cli) or punted to the model with nothing, and the
   * 2026-08-20 bench showed what the model does with nothing.
   */
  manifestApps?: readonly RouteManifestApp[]
}

/** A deterministic proposal, or the reason the path refused to produce one. */
export type ProposeRecipeOutcome =
  | {
      ok: true
      recipe: Recipe
      ecosystem: RecipeEcosystem
      /** Human fill-ins the CLI prints — credential env vars, unmappable schemes. */
      todos: string[]
      /**
       * The datastore compose file this proposal REQUIRES to exist, when
       * the proposer generated one. The caller writes it before verification and
       * removes it if the proposal is rejected — this module never touches disk.
       */
      compose?: ComposePlan
    }
  | { ok: false; reason: string }

/**
 * The per-ecosystem intermediate every detector produces: the commands and argvs
 * that are the repo's OWN, before the language-agnostic assembly (health path,
 * services, credentials) turns them into a recipe.
 */
interface RecipeSignals {
  ecosystem: RecipeEcosystem
  /** Dependency-fetch command; omitted when there is nothing to fetch. */
  install?: string
  /** Always present — `"true"` is the documented no-op for a build-less repo. */
  build: string
  /** The cli driver's entrypoint argv. */
  entry?: string[]
  /** The api driver's server argv (may carry `${PORT}`). */
  serve?: string[]
  /** Env the server needs (may carry `${PORT}`). */
  serveEnv?: Record<string, string>
  /** The workspace member dir the serve argv drives (`apps/api/v2`). Implies the
   *  argv is workspace-mediated and must run at the repo root (`cwd: "repo"`). */
  serveApp?: string
  /** The health path read off the member's OWN routes — outranks the generic
   *  route-surface ranking, which spans every app at once. */
  serveHealthPath?: string
}

/** Health endpoints in the order a repo most likely means "I am up". */
const HEALTH_PATH_RANKING = [
  '/healthz',
  '/health',
  '/readyz',
  '/livez',
  '/healthcheck',
  '/_health',
  '/api/health',
  '/api/healthz',
  '/ping',
  '/status',
]

/** Container images that mean "this repo needs a datastore up first". */
const DATABASE_IMAGES = new Set([
  'postgres',
  'postgis',
  'timescaledb',
  'mysql',
  'mariadb',
  'mongo',
  'mongodb',
  'redis',
  'valkey',
  'elasticsearch',
  'opensearch',
  'clickhouse',
  'cockroachdb',
  'cassandra',
  'rabbitmq',
  'kafka',
  'minio',
])

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

/**
 * Derive a recipe from the repository's own declarations, or explain why not.
 * Pure over the working tree plus its inputs — no LLM, no analysis pass, no
 * process spawned (verification is the caller's job).
 */
export function proposeRecipe(repoRoot: string, inputs: ProposeRecipeInputs = {}): ProposeRecipeOutcome {
  const ecosystems = detectEcosystems(repoRoot)
  if (ecosystems.length === 0) return { ok: false, reason: 'no package.json, pyproject.toml, requirements.txt, or .csproj at the repo root' }
  if (ecosystems.length > 1) {
    return { ok: false, reason: `multiple ecosystems at the repo root (${ecosystems.join(', ')}) — which one serves the app is not deterministic` }
  }

  const ecosystem = ecosystems[0]
  const detected =
    ecosystem === 'js' ? detectJs(repoRoot, inputs) : ecosystem === 'python' ? detectPython(repoRoot) : detectDotnet(repoRoot)
  if (!('ecosystem' in detected)) return detected

  return assemble(repoRoot, detected, inputs)
}

/**
 * The api route surface as the proposer consumes it — the method + path of every
 * operation-rooted interface. Lets a caller that already mapped interfaces hand the
 * surface over without a second analysis pass.
 *
 * RPC-derived operations are left out (item 12): they are the same procedure
 * behind one adapter address, so probing them says nothing a probe of the app's
 * own routes does not, and they are excluded from scenario generation this round
 * anyway.
 */
export function routesFromInterfaces(interfaces: readonly Interface[]): ApiRouteRef[] {
  const routes: ApiRouteRef[] = []
  for (const j of interfaces) {
    if (j.procedure) continue
    const entry = j.entry as { method?: string; path?: string }
    if (typeof entry?.method === 'string' && typeof entry.path === 'string') {
      routes.push({ method: entry.method, path: entry.path })
    }
  }
  return routes
}

// ---------------------------------------------------------------------------
// Ecosystem detection
// ---------------------------------------------------------------------------

/** Every ecosystem whose manifest is present at the repo root. More than one is
 *  a bail: nothing in the tree says which of them is the app under test. */
export function detectEcosystems(repoRoot: string): RecipeEcosystem[] {
  const found: RecipeEcosystem[] = []
  if (exists(repoRoot, 'package.json')) found.push('js')
  if (exists(repoRoot, 'pyproject.toml') || exists(repoRoot, 'requirements.txt') || exists(repoRoot, 'manage.py')) {
    found.push('python')
  }
  if (findCsprojFiles(repoRoot).length > 0) found.push('dotnet')
  return found
}

// ---------------------------------------------------------------------------
// JS / TS
// ---------------------------------------------------------------------------

/** Watch/dev markers: a watcher is not a server under test. Exported for the
 *  static proposal check in `recipe-discovery.ts` (`staticProposalComplaints`),
 *  so the refusal rule and the derivation share one list. */
export const DEV_SCRIPT_MARKERS = [
  'nodemon',
  '--watch',
  'watch ',
  'ts-node-dev',
  'tsx watch',
  'vite',
  'next dev',
  'concurrently',
  'webpack serve',
  '--hot',
  'react-scripts',
]

/** Shell metacharacters an argv cannot carry — a compound command is not argv.
 *  Exported for `staticProposalComplaints` in `recipe-discovery.ts` — one list. */
export const SHELL_OPERATORS = ['&&', '||', '|', ';', '>', '<', '`', '$(', '&']

/** Framework dependencies that mean "this package serves HTTP". */
const JS_SERVER_DEPS = ['express', 'fastify', 'koa', '@hapi/hapi', '@nestjs/core', 'hono', 'restify', 'polka']

function detectJs(repoRoot: string, inputs: ProposeRecipeInputs = {}): RecipeSignals | { ok: false; reason: string } {
  const pkg = readJson(path.join(repoRoot, 'package.json'))
  if (!pkg) return { ok: false, reason: 'package.json is not readable JSON' }

  // A workspace root prepares N packages, not one app — EXCEPT when exactly one
  // member declares a `bin`. A monorepo's root manifest routinely declares none
  // (this repo's does), and refusing there sent every such repo to the model with
  // only the root package.json to read: it cannot see the member that ships the
  // cli, so it invents one. One bin-declaring member removes the ambiguity rule 1
  // exists to protect, and the proposal is verified like any other.
  const workspaceRoot =
    Array.isArray(pkg.workspaces) ||
    (pkg.workspaces != null && typeof pkg.workspaces === 'object') ||
    exists(repoRoot, 'pnpm-workspace.yaml')
  let memberBin: string | null = null
  let memberServe: WorkspaceMemberServe | null = null
  if (workspaceRoot) {
    // The api half first: the route manifest names which members SERVE, so a
    // monorepo whose most-routed member has a plain `start` script derives an api
    // proposal — the cli-bin rules below used to be this branch's only exit.
    memberServe = workspaceMemberServe(repoRoot, inputs.manifestApps ?? [])
    const members = binDeclaringMembers(repoRoot)
    if (!memberServe) {
      if (members.length === 0) {
        return {
          ok: false,
          reason: 'the repo declares workspaces and no workspace package declares a `bin` — the app under test is one of several packages',
        }
      }
      if (members.length > 1) {
        return {
          ok: false,
          reason: `the repo declares workspaces and ${members.length} packages declare a \`bin\` (${members.map((m) => m.dir).join(', ')}) — the cli entrypoint is not deterministic`,
        }
      }
    }
    // With an api member decided, the cli half is optional: exactly one bin still
    // rides along; zero or several just means the proposal is api-only.
    if (members.length === 1) memberBin = members[0].bin
  }

  const pm = detectPackageManager(repoRoot)
  const scripts = asRecord(pkg.scripts)
  const deps = { ...asRecord(pkg.dependencies), ...asRecord(pkg.devDependencies), ...asRecord(pkg.optionalDependencies) }

  // Nothing declared to install ⇒ no install step. Running a package manager to
  // fetch zero dependencies is pure waste (and a network round-trip in CI).
  const install = Object.keys(deps).length > 0 ? pm.install : undefined
  const build = typeof scripts.build === 'string' && scripts.build.trim() ? pm.run('build') : 'true'
  const hasBuild = build !== 'true'

  const signals: RecipeSignals = { ecosystem: 'js', ...(install ? { install } : {}), build }

  // The cli half: `bin` as a string, or a single-entry object — from the workspace
  // member that declares it, else from this package. Several bins is a multi-tool
  // package — which one a scenario drives is not deterministic.
  const bin = workspaceRoot ? memberBin : binPath(pkg.bin)
  if (bin === 'ambiguous') {
    return { ok: false, reason: 'package.json declares several `bin` entries — the cli entrypoint is not deterministic' }
  }
  if (bin && (hasBuild || existsFile(repoRoot, bin))) signals.entry = ['node', bin]

  // The api half of a WORKSPACE: the member the route manifest crowned, driven
  // through the package manager so it runs from the repo root.
  if (memberServe) {
    signals.serve = memberServe.serve
    signals.serveApp = memberServe.app
    if (memberServe.healthPath) signals.serveHealthPath = memberServe.healthPath
  }

  // The api half: a tokenized `start` script, kept only when it is a plain
  // single-command invocation of something this repo produces. A workspace ROOT's
  // `start` is not one app's — it is whatever the root wires up — so it is never
  // read as a serve argv; the member's cli is all the ambiguity check cleared.
  const start = !workspaceRoot && typeof scripts.start === 'string' ? scripts.start : ''
  if (start.trim()) {
    const argv = tokenizeCommand(start)
    if (argv && (hasBuild || argvFilesExist(repoRoot, argv))) signals.serve = argv
  }

  const looksLikeServer =
    signals.serve !== undefined || Object.keys(deps).some((d) => JS_SERVER_DEPS.includes(d))
  if (!signals.entry && !signals.serve) {
    return {
      ok: false,
      reason: looksLikeServer
        ? 'the package looks like an HTTP server but declares no runnable `scripts.start` argv'
        : 'package.json declares neither a usable `bin` (cli) nor a `scripts.start` (api)',
    }
  }
  return signals
}

/** One derivable workspace api member: what `workspaceMemberServe` decides. */
interface WorkspaceMemberServe {
  serve: string[]
  /** Repo-relative member dir — becomes `api.app`, and implies `cwd: "repo"`. */
  app: string
  /** A health route the member ITSELF declares, when it declares one. */
  healthPath?: string
}

/** Dirs that ship alongside the product without BEING it — a routed app under
 *  one of these is a demo, never the server under test (the item-107 rule,
 *  applied to recipes: cal.com's `example-apps/credential-sync` is routed and
 *  must still lose to `apps/api/v2`). */
const EXAMPLE_DIR = /(^|\/)(examples?|example-apps|demos?|fixtures?|samples?|e2e|__tests?__|tests?)(\/|$)/

/**
 * The workspace member the deterministic api proposal drives: the most-routed
 * non-example app with a plain (non-watcher) `start` script. One member, single
 * `serve` — a second routed app is the SESSION's to add under `api.servers`;
 * this path only has to beat "no prior proposal at all". Null when no member
 * qualifies, which keeps the old punt (with the manifest riding into the model's
 * briefing) exactly as it was.
 */
function workspaceMemberServe(
  repoRoot: string,
  apps: readonly RouteManifestApp[],
): WorkspaceMemberServe | null {
  const routed = apps
    .filter((app) => app.routes.length > 0 && !EXAMPLE_DIR.test(app.dir))
    .sort((a, b) => b.routes.length - a.routes.length)
  const best = routed[0]
  if (!best) return null
  const memberPkg = readJson(path.join(repoRoot, best.dir, 'package.json'))
  const name = typeof memberPkg?.name === 'string' && memberPkg.name ? memberPkg.name : null
  const start = asRecord(memberPkg?.scripts).start
  if (!name || typeof start !== 'string' || !start.trim()) return null
  if (DEV_SCRIPT_MARKERS.some((marker) => start.toLowerCase().includes(marker))) return null
  const healthPath = rankHealthPath(best.routes.map((route) => ({ method: 'GET', path: route })))
  return {
    serve: workspaceRunArgv(repoRoot, name),
    app: best.dir,
    ...(healthPath ? { healthPath } : {}),
  }
}

/** The argv that runs one member's `start` from the repo root, per package manager. */
function workspaceRunArgv(repoRoot: string, pkgName: string): string[] {
  if (exists(repoRoot, 'pnpm-lock.yaml')) return ['pnpm', '--filter', pkgName, 'run', 'start']
  if (exists(repoRoot, 'yarn.lock')) return ['yarn', 'workspace', pkgName, 'start']
  return ['npm', 'run', 'start', '-w', pkgName]
}

/** `npm ci` / `pnpm install --frozen-lockfile` / `yarn install --immutable`, from
 *  the lockfile that is actually committed; no lockfile falls back to `npm install`. */
function detectPackageManager(repoRoot: string): { install: string; run: (script: string) => string } {
  if (exists(repoRoot, 'pnpm-lock.yaml')) {
    return { install: 'pnpm install --frozen-lockfile', run: (s) => `pnpm run ${s}` }
  }
  if (exists(repoRoot, 'yarn.lock')) {
    return { install: 'yarn install --immutable', run: (s) => `yarn ${s}` }
  }
  if (exists(repoRoot, 'package-lock.json')) {
    return { install: 'npm ci', run: (s) => `npm run ${s}` }
  }
  return { install: 'npm install', run: (s) => `npm run ${s}` }
}

/**
 * The workspace packages that declare a `bin`, with that bin resolved to a
 * REPO-relative path (the entry argv is stored repo-relative). A member whose
 * `bin` is itself ambiguous (several entries) is skipped: it cannot name a single
 * entrypoint, so it can only add ambiguity, never resolve it.
 */
function binDeclaringMembers(repoRoot: string): { dir: string; bin: string }[] {
  const out: { dir: string; bin: string }[] = []
  for (const dir of workspacePackageDirs(repoRoot)) {
    const memberPkg = readJson(path.join(repoRoot, dir, 'package.json'))
    if (!memberPkg) continue
    const bin = binPath(memberPkg.bin)
    if (!bin || bin === 'ambiguous') continue
    out.push({ dir, bin: path.posix.join(dir, bin.replace(/^\.\//, '')) })
  }
  return out
}

/** The single `bin` path, `null` when there is none, `'ambiguous'` for several. */
function binPath(bin: unknown): string | null | 'ambiguous' {
  if (typeof bin === 'string') return bin
  if (bin && typeof bin === 'object' && !Array.isArray(bin)) {
    const values = Object.values(bin as Record<string, unknown>).filter((v): v is string => typeof v === 'string')
    if (values.length === 1) return values[0]
    if (values.length > 1) return 'ambiguous'
  }
  return null
}

/**
 * A shell command as argv, or `null` when it is not one: anything with a shell
 * operator, an inline env assignment, a package-manager indirection, or a
 * watch/dev marker is REFUSED — the runner spawns argv directly, and a watcher
 * under test reloads mid-scenario.
 */
export function tokenizeCommand(command: string): string[] | null {
  const trimmed = command.trim()
  if (!trimmed) return null
  const lower = trimmed.toLowerCase()
  if (SHELL_OPERATORS.some((op) => trimmed.includes(op))) return null
  if (DEV_SCRIPT_MARKERS.some((marker) => lower.includes(marker))) return null

  const tokens = splitTokens(trimmed)
  if (!tokens || tokens.length === 0) return null
  // `FOO=bar node server.js` is a shell construct, not argv.
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) return null
  // `npm run start:prod` hides the real argv one level down (and swallows signals).
  if (['npm', 'pnpm', 'yarn', 'npx', 'pnpx', 'bunx'].includes(tokens[0])) return null
  return tokens
}

/** Whitespace split honoring single and double quotes; `null` on an unbalanced quote. */
function splitTokens(command: string): string[] | null {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let started = false
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      started = true
      continue
    }
    if (/\s/.test(ch)) {
      if (started) tokens.push(current)
      current = ''
      started = false
      continue
    }
    current += ch
    started = true
  }
  if (quote) return null
  if (started) tokens.push(current)
  return tokens
}

/** Every repo-relative FILE-looking argument of an argv exists on disk. Applied
 *  only when the recipe has no build step: with a build, the artifact is produced
 *  by it, and `verifyProposal` checks after the build runs. */
function argvFilesExist(repoRoot: string, argv: readonly string[]): boolean {
  const candidates = argv.slice(1).filter((a) => !a.startsWith('-') && /[./]/.test(a))
  return candidates.every((a) => existsFile(repoRoot, a))
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

/** Root-level files that conventionally hold the ASGI/WSGI app. */
const PY_APP_FILES = ['main.py', 'app.py', 'api.py', 'server.py', 'asgi.py', 'wsgi.py']

function detectPython(repoRoot: string): RecipeSignals | { ok: false; reason: string } {
  const declared = pythonDeclaredDeps(repoRoot)
  const install = pythonInstall(repoRoot)
  const signals: RecipeSignals = { ecosystem: 'python', ...(install ? { install } : {}), build: 'true' }

  // Django announces itself with `manage.py`, and its runserver argv is fixed.
  if (exists(repoRoot, 'manage.py')) {
    signals.serve = ['python3', 'manage.py', 'runserver', '127.0.0.1:${PORT}']
    return signals
  }

  if (declared.has('fastapi')) {
    const found = findAppAssignment(repoRoot, 'FastAPI')
    if ('reason' in found) return { ok: false, reason: found.reason }
    // `python3 -m uvicorn` rather than the bare console script: it runs wherever
    // uvicorn is IMPORTABLE, which is the same condition the app itself needs.
    // `--app-dir .` is what makes the import string resolvable: the runner boots
    // the server from a sandbox temp cwd, and without it uvicorn would look for
    // the app module there. The runner absolutizes the anchored `.` to the repo.
    signals.serve = [
      'python3',
      '-m',
      'uvicorn',
      `${found.module}:${found.attribute}`,
      '--app-dir',
      '.',
      '--host',
      '127.0.0.1',
      '--port',
      '${PORT}',
    ]
    return signals
  }

  if (declared.has('flask')) {
    const found = findAppAssignment(repoRoot, 'Flask')
    if ('reason' in found) return { ok: false, reason: found.reason }
    // Flask's `--app` takes a FILE path with the attribute appended, and the file
    // is what the runner absolutizes — the sandbox's temp cwd would never import a
    // bare `module:attr` (flask has no `--app-dir`).
    signals.serve = [
      'python3',
      '-m',
      'flask',
      '--app',
      `${found.file}:${found.attribute}`,
      'run',
      '--host',
      '127.0.0.1',
      '--port',
      '${PORT}',
    ]
    return signals
  }

  // The cli half: a root-level package with a `__main__.py` is runnable as
  // `python3 -m <pkg>` from the repo root — the only python entrypoint that is
  // definitely on the path the runner spawns with. `[project.scripts]` console
  // scripts are NOT proposed: they live in a virtualenv that may not be active.
  const mains = rootDirs(repoRoot).filter((d) => existsFile(repoRoot, path.join(d, '__main__.py')))
  if (mains.length === 1) {
    signals.entry = ['python3', '-m', mains[0]]
    return signals
  }
  if (mains.length > 1) {
    return { ok: false, reason: `several runnable python packages (${mains.join(', ')}) — the entrypoint is not deterministic` }
  }
  return { ok: false, reason: 'no django/fastapi/flask app and no `__main__.py` package — the python entrypoint is not deterministic' }
}

/** `uv sync` / `poetry install` / `pip install -r requirements.txt`, from the
 *  lockfile or requirements file the repo actually commits. */
function pythonInstall(repoRoot: string): string | undefined {
  if (exists(repoRoot, 'uv.lock')) return 'uv sync'
  if (exists(repoRoot, 'poetry.lock')) return 'poetry install'
  if (exists(repoRoot, 'requirements.txt')) return 'pip install -r requirements.txt'
  return undefined
}

/** The distribution names the project declares, lowercased — read tolerantly out
 *  of `pyproject.toml`'s dependency lines and `requirements.txt`. */
function pythonDeclaredDeps(repoRoot: string): Set<string> {
  const names = new Set<string>()
  const add = (raw: string) => {
    const name = raw
      .trim()
      .replace(/^["']|["'],?$/g, '')
      .split(/[<>=!~;[\s]/)[0]
      .trim()
      .toLowerCase()
    if (name && !name.startsWith('#')) names.add(name)
  }
  const pyproject = readText(path.join(repoRoot, 'pyproject.toml'))
  if (pyproject) {
    // Every quoted requirement string in the file — dependency tables differ across
    // PEP 621 / poetry / uv, but they all quote the distribution name.
    for (const m of pyproject.matchAll(/["']([A-Za-z0-9._-]+)\s*(?:[<>=!~[][^"']*)?["']/g)) add(m[1])
    // Poetry's `[tool.poetry.dependencies]` table keys are bare identifiers.
    const poetryTable = pyproject.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(\n\[|$)/)
    if (poetryTable) {
      for (const line of poetryTable[1].split('\n')) {
        const key = line.match(/^\s*([A-Za-z0-9._-]+)\s*=/)
        if (key) add(key[1])
      }
    }
  }
  const requirements = readText(path.join(repoRoot, 'requirements.txt'))
  if (requirements) for (const line of requirements.split('\n')) if (line.trim() && !line.trim().startsWith('-')) add(line)
  return names
}

/**
 * The single module holding `<attr> = <Ctor>(…)`, searched over the conventional
 * app files at the repo root and one level down inside importable packages. Two
 * candidates is a bail — booting the wrong app is worse than an LLM call.
 *
 * Reports the hit BOTH ways: the dotted `module` an import string needs (uvicorn)
 * and the repo-relative `file` a path argument needs (flask's `--app`).
 */
function findAppAssignment(
  repoRoot: string,
  ctor: string,
): { module: string; file: string; attribute: string } | { reason: string } {
  const candidates: string[] = [...PY_APP_FILES]
  for (const dir of rootDirs(repoRoot)) {
    if (!existsFile(repoRoot, path.join(dir, '__init__.py'))) continue
    for (const file of PY_APP_FILES) candidates.push(path.join(dir, file))
  }

  const pattern = new RegExp(`^\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*${ctor}\\s*\\(`, 'm')
  const hits: { module: string; file: string; attribute: string }[] = []
  for (const rel of candidates) {
    const content = readText(path.join(repoRoot, rel))
    if (!content) continue
    const match = content.match(pattern)
    if (!match) continue
    hits.push({
      module: rel.replace(/\.py$/, '').split(path.sep).join('.'),
      file: rel.split(path.sep).join('/'),
      attribute: match[1],
    })
  }
  if (hits.length === 1) return hits[0]
  if (hits.length === 0) return { reason: `no \`app = ${ctor}(…)\` assignment found in the conventional entry modules` }
  return {
    reason: `several ${ctor} apps (${hits.map((h) => `${h.module}:${h.attribute}`).join(', ')}) — the server module is not deterministic`,
  }
}

// ---------------------------------------------------------------------------
// C# / .NET
// ---------------------------------------------------------------------------

function detectDotnet(repoRoot: string): RecipeSignals | { ok: false; reason: string } {
  const projects = findCsprojFiles(repoRoot)
  if (projects.length !== 1) {
    return { ok: false, reason: `${projects.length} .csproj files under the repo root — the project under test is not deterministic` }
  }
  const rel = projects[0]
  const content = readText(path.join(repoRoot, rel)) ?? ''
  // `dotnet restore` folds into `dotnet build`, so .NET needs no install step; the
  // run is `--no-build` so it reuses exactly what verification built.
  const signals: RecipeSignals = { ecosystem: 'dotnet', build: `dotnet build -c Release ${rel}` }
  const run = ['dotnet', 'run', '--project', rel, '--no-build', '-c', 'Release']

  if (/Sdk\s*=\s*"Microsoft\.NET\.Sdk\.Web"/.test(content)) {
    signals.serve = run
    // Kestrel binds what ASPNETCORE_URLS names; `PORT` alone means nothing to it.
    signals.serveEnv = { ASPNETCORE_URLS: 'http://127.0.0.1:${PORT}' }
    return signals
  }
  if (/<OutputType>\s*Exe\s*<\/OutputType>/i.test(content)) {
    signals.entry = run
    return signals
  }
  return { ok: false, reason: `${rel} is neither a web SDK project nor an <OutputType>Exe</OutputType> console app` }
}

/** Every `.csproj` under the repo root, depth-limited and skipping build output. */
function findCsprojFiles(repoRoot: string, maxDepth = 3): string[] {
  const skip = new Set(['bin', 'obj', 'node_modules', '.git', '.truecourse', 'dist', 'build', 'target'])
  const found: string[] = []
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.csproj')) {
        found.push(path.relative(repoRoot, path.join(dir, entry.name)))
      } else if (entry.isDirectory() && depth < maxDepth && !skip.has(entry.name) && !entry.name.startsWith('.')) {
        walk(path.join(dir, entry.name), depth + 1)
      }
    }
  }
  walk(repoRoot, 0)
  return found.sort()
}

// ---------------------------------------------------------------------------
// Assembly — the language-agnostic half
// ---------------------------------------------------------------------------

function assemble(repoRoot: string, signals: RecipeSignals, inputs: ProposeRecipeInputs): ProposeRecipeOutcome {
  const todos: string[] = []
  const recipe: Record<string, unknown> = {
    ...(signals.install ? { install: signals.install } : {}),
    build: signals.build,
    ...(signals.entry ? { entry: signals.entry } : {}),
  }

  let compose: ComposePlan | undefined
  if (signals.serve) {
    const healthPath = signals.serveHealthPath ?? rankHealthPath(inputs.routes ?? [])
    const schemes = inputs.securitySchemes ?? readCorpusSecuritySchemes(repoRoot)
    const { credentials, notes } = credentialStubs(schemes)
    todos.push(...notes)
    let services = detectComposeServices(repoRoot)
    let apiEnv: Record<string, string> = { ...(signals.serveEnv ?? {}) }
    // The repo declares a datastore in its source but ships no compose file to run
    // it: derive one. The compose file is not written here — this module
    // proposes, the caller writes it and verifies it, and deletes it if it fails.
    if (!services) {
      const generated = generateDatastore(repoRoot, inputs.datastores ?? [])
      if (generated) {
        services = generated.plan.services
        apiEnv = { ...apiEnv, ...generated.plan.env }
        todos.push(...generated.plan.notes)
        if (generated.write) compose = generated.plan
      }
    }
    recipe.api = {
      serve: signals.serve,
      // A workspace-mediated argv must run at the repo root, and the member dir
      // it drives is a fact the recipe states (`api.app`) so downstream mapping
      // knows which app is the one under test.
      ...(signals.serveApp ? { app: signals.serveApp, cwd: 'repo' } : {}),
      ...(healthPath ? { healthPath } : {}),
      ...(Object.keys(apiEnv).length > 0 ? { env: apiEnv } : {}),
      ...(services ? { services } : {}),
      ...(credentials ? { credentials } : {}),
    }
  }

  const parsed = RecipeSchema.safeParse(recipe)
  if (!parsed.success) {
    return { ok: false, reason: `the derived recipe is not valid: ${parsed.error.issues.map((i) => i.message).join('; ')}` }
  }
  return { ok: true, recipe: parsed.data, ecosystem: signals.ecosystem, todos, ...(compose ? { compose } : {}) }
}

/**
 * The generated-datastore decision, for a repo whose own compose files declare no
 * datastore:
 *
 *  - nothing derivable (no connection URL, an unmapped engine, a remote host) ⇒
 *    `undefined`, and the boot failure falls through to discovery's guided
 *    "start your database / add a compose file / hand-write `api.services`" message;
 *  - derivable, and the guard compose file is NOT already referenced by a recipe ⇒
 *    propose it AND write it (`write: true`) — an orphaned file from an earlier
 *    refused run is guard's own to replace;
 *  - derivable, but an existing `recipe.json` already runs the guard compose file ⇒
 *    propose the same services and env, and do NOT rewrite the file. It is a
 *    reviewed, committed artifact by then, and a `--refresh` must not silently
 *    revert someone's edits to it.
 */
function generateDatastore(
  repoRoot: string,
  datastores: readonly DatastoreUrlRef[],
): { plan: ComposePlan; write: boolean } | undefined {
  if (datastores.length === 0) return undefined
  const derived = deriveGuardCompose(datastores)
  if (!derived.ok) return undefined
  return { plan: derived.plan, write: !guardComposeInUse(repoRoot) }
}

/** Does a recipe already on disk run {@link GUARD_COMPOSE_FILE}? */
function guardComposeInUse(repoRoot: string): boolean {
  const recipe = readJson(recipePath(repoRoot))
  const services = asRecord(asRecord(recipe?.api).services)
  return typeof services.up === 'string' && services.up.includes(GUARD_COMPOSE_FILE)
}

/** The best-ranked health endpoint the route surface ACTUALLY declares, else
 *  `undefined` — the runner's `/` default is the honest answer for a repo with
 *  no health route, and a health path that 404s would fail every boot. */
export function rankHealthPath(routes: readonly ApiRouteRef[]): string | undefined {
  const gets = new Set(
    routes.filter((r) => r.method.toUpperCase() === 'GET').map((r) => normalizeRoutePath(r.path)),
  )
  return HEALTH_PATH_RANKING.find((candidate) => gets.has(candidate))
}

function normalizeRoutePath(routePath: string): string {
  const trimmed = routePath.trim()
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, '') : withSlash
}

/**
 * `docker compose up -d --wait` / `down` when the root compose file declares a
 * datastore image. The repo's own commands — the runner orchestrates nothing
 * itself, it just runs what the recipe names.
 *
 * `--wait` is not decoration: plain `up -d` returns as soon as the containers are
 * CREATED, and the server boots microseconds later against a Postgres that is not
 * yet accepting connections — measured against the `speced-api` bench, where the
 * app's boot migration died on exactly that race. With a healthcheck in the compose
 * file `--wait` blocks until the datastore is healthy; without one it costs nothing
 * (it waits for `running`, which `up -d` already reached).
 */
export function detectComposeServices(
  repoRoot: string,
): { up: string; down: string; reset?: string } | undefined {
  const file = COMPOSE_FILES.map((f) => path.join(repoRoot, f)).find((f) => fs.existsSync(f))
  if (!file) return undefined
  let doc: unknown
  try {
    doc = yaml.load(fs.readFileSync(file, 'utf-8'))
  } catch {
    return undefined
  }
  const services = asRecord((doc as Record<string, unknown> | null)?.services)
  const hasDatabase = Object.values(services).some((service) => {
    const image = asRecord(service).image
    if (typeof image !== 'string') return false
    const base = image.split('@')[0].split(':')[0].split('/').pop() ?? ''
    return DATABASE_IMAGES.has(base.toLowerCase())
  })
  // `reset` wipes the volumes so a `world: mutates` tail cannot leak damage into
  // the next run; `down` deliberately preserves them (stopping is not forgetting).
  return hasDatabase
    ? { up: 'docker compose up -d --wait', down: 'docker compose down', reset: 'docker compose down -v' }
    : undefined
}

/**
 * Credential STUBS for the security schemes a header can carry: the scheme key is
 * the credential name AND its `satisfies`, the value comes from a predictable
 * `GUARD_CRED_*` env var the user must set. Schemes no header maps
 * (oauth2 / openIdConnect / an apiKey in a query or cookie) get no stub — they get
 * a TODO naming what has to be added by hand.
 */
export function credentialStubs(schemes: Record<string, SecurityScheme>): {
  credentials?: Record<string, RecipeApiCredential>
  notes: string[]
} {
  const credentials: Record<string, RecipeApiCredential> = {}
  const notes: string[] = []
  for (const [key, scheme] of Object.entries(schemes)) {
    const env = credentialEnvName(key)
    const type = scheme.type.toLowerCase()
    const httpScheme = scheme.scheme?.toLowerCase()
    if (type === 'apikey' && scheme.in === 'header' && scheme.name) {
      credentials[key] = {
        header: scheme.name,
        valueFromEnv: env,
        satisfies: key,
        description: `TODO: fill in — apiKey header "${scheme.name}" for the "${key}" security scheme`,
      }
      notes.push(`set ${env} — the apiKey sent as the "${scheme.name}" header (scheme "${key}")`)
    } else if (type === 'http' && httpScheme === 'bearer') {
      credentials[key] = {
        header: 'Authorization',
        valueFromEnv: env,
        satisfies: key,
        description: `TODO: fill in — bearer token for the "${key}" security scheme (include the "Bearer " prefix)`,
      }
      notes.push(`set ${env} — the Authorization value for the "${key}" bearer scheme (include the "Bearer " prefix)`)
    } else if (type === 'http' && httpScheme === 'basic') {
      credentials[key] = {
        header: 'Authorization',
        valueFromEnv: env,
        satisfies: key,
        description: `TODO: fill in — basic credentials for the "${key}" security scheme (the whole "Basic <base64>" value)`,
      }
      notes.push(`set ${env} — the Authorization value for the "${key}" basic scheme (the whole "Basic <base64>" value)`)
    } else {
      notes.push(
        `security scheme "${key}" (${scheme.type}${httpScheme ? ` ${httpScheme}` : ''}${scheme.in ? ` in ${scheme.in}` : ''}) has no request-header form — add an api.credentials entry for it by hand`,
      )
    }
  }
  return { ...(Object.keys(credentials).length > 0 ? { credentials } : {}), notes }
}

/** `GUARD_CRED_<SCHEME_KEY>` — predictable, so the printed TODO IS the instruction. */
export function credentialEnvName(schemeKey: string): string {
  return `GUARD_CRED_${schemeKey.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`
}

/** The security schemes declared by the corpus's OpenAPI docs, merged. Missing or
 *  unreadable corpus → no schemes, never a failure. */
function readCorpusSecuritySchemes(repoRoot: string): Record<string, SecurityScheme> {
  const corpus = readJson(path.join(repoRoot, '.truecourse', 'specs', 'corpus.json'))
  const docs = Array.isArray(corpus?.docs) ? corpus.docs : []
  const schemes: Record<string, SecurityScheme> = {}
  for (const entry of docs) {
    const ref = asRecord(entry).ref
    if (typeof ref !== 'string') continue
    const content = readText(path.resolve(repoRoot, ref))
    if (!content || !isOpenApiDoc(ref, content)) continue
    const doc = parseOpenApiSpec(content)
    if (!doc) continue
    Object.assign(schemes, parseSecuritySchemes(doc))
  }
  return schemes
}

// ---------------------------------------------------------------------------
// Small file helpers
// ---------------------------------------------------------------------------

function exists(repoRoot: string, rel: string): boolean {
  return fs.existsSync(path.join(repoRoot, rel))
}

function existsFile(repoRoot: string, rel: string): boolean {
  const abs = path.resolve(repoRoot, rel)
  return fs.existsSync(abs) && fs.statSync(abs).isFile()
}

function rootDirs(repoRoot: string): string[] {
  try {
    return fs
      .readdirSync(repoRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf-8')
  } catch {
    return null
  }
}

function readJson(file: string): Record<string, unknown> | null {
  const text = readText(file)
  if (text === null) return null
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
