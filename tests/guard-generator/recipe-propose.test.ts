/**
 * The deterministic recipe proposer — recipe discovery's free first pass. Every
 * test here is a REPOSITORY, written into a temp dir, and the assertion is the
 * recipe its own declarations imply (or the reason the detectors refused to
 * decide). No LLM, no verification: this module proposes, and the engine's
 * `verifyProposal` is what says yes.
 *
 * The bail cases matter as much as the hits — the whole design bet is that a wrong
 * deterministic recipe is worse than an LLM call.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  proposeRecipe,
  rankHealthPath,
  credentialStubs,
  credentialEnvName,
  tokenizeCommand,
  routesFromInterfaces,
  type ApiRouteRef,
} from '@truecourse/guard-generator'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})

/** A synthetic repository: a file map (relative path → content) on disk. */
function repoOf(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-propose-'))
  dirs.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  return dir
}

const json = (value: unknown) => JSON.stringify(value, null, 2)

/** The proposal, asserting it was one (a bail fails the test with its reason). */
function proposal(repo: string, routes?: readonly ApiRouteRef[]) {
  const outcome = proposeRecipe(repo, { routes, securitySchemes: {} })
  if (!outcome.ok) throw new Error(`expected a proposal, got a bail: ${outcome.reason}`)
  return outcome
}

/** The bail reason, asserting it bailed. */
function bail(repo: string, routes?: readonly ApiRouteRef[]): string {
  const outcome = proposeRecipe(repo, { routes, securitySchemes: {} })
  if (outcome.ok) throw new Error(`expected a bail, got ${JSON.stringify(outcome.recipe)}`)
  return outcome.reason
}

// ---------------------------------------------------------------------------
// JS / TS
// ---------------------------------------------------------------------------

describe('proposeRecipe — JS/TS', () => {
  const LOCKFILES: { file: string; install: string; build: string }[] = [
    { file: 'package-lock.json', install: 'npm ci', build: 'npm run build' },
    { file: 'pnpm-lock.yaml', install: 'pnpm install --frozen-lockfile', build: 'pnpm run build' },
    { file: 'yarn.lock', install: 'yarn install --immutable', build: 'yarn build' },
  ]

  for (const lock of LOCKFILES) {
    it(`installs from the committed lockfile — ${lock.file}`, () => {
      const repo = repoOf({
        'package.json': json({
          name: 'svc',
          dependencies: { express: '^4' },
          scripts: { build: 'tsc -p tsconfig.json', start: 'node dist/index.js' },
        }),
        [lock.file]: '',
      })

      const out = proposal(repo)

      expect(out.recipe.install).toBe(lock.install)
      expect(out.recipe.build).toBe(lock.build)
    })
  }

  it('falls back to `npm install` with no lockfile at all', () => {
    const repo = repoOf({
      'package.json': json({ name: 'svc', dependencies: { express: '^4' }, scripts: { start: 'node server.js' } }),
      'server.js': '',
    })

    expect(proposal(repo).recipe.install).toBe('npm install')
  })

  it('omits install entirely when the package declares no dependencies', () => {
    const repo = repoOf({
      'package.json': json({ name: 'svc', scripts: { start: 'node server.js' } }),
      'package-lock.json': '',
      'server.js': '',
    })

    // Running a package manager to fetch nothing is pure waste, and `install` is
    // optional in the recipe schema.
    expect(proposal(repo).recipe.install).toBeUndefined()
  })

  it('uses `"true"` — the documented no-op — when there is no build script', () => {
    const repo = repoOf({
      'package.json': json({ name: 'svc', scripts: { start: 'node server.js' } }),
      'server.js': '',
    })

    expect(proposal(repo).recipe.build).toBe('true')
  })

  it('tokenizes a plain `scripts.start` into the serve argv', () => {
    const repo = repoOf({
      'package.json': json({ name: 'svc', scripts: { build: 'tsc', start: 'node dist/index.js --quiet' } }),
    })

    expect(proposal(repo).recipe.api?.serve).toEqual(['node', 'dist/index.js', '--quiet'])
  })

  it('derives the cli entry from a string `bin`', () => {
    const repo = repoOf({ 'package.json': json({ name: 'tool', bin: 'bin/cli.js' }), 'bin/cli.js': '' })

    const out = proposal(repo)
    expect(out.recipe.entry).toEqual(['node', 'bin/cli.js'])
    expect(out.recipe.api).toBeUndefined()
  })

  it('derives the cli entry from a single-entry `bin` object', () => {
    const repo = repoOf({ 'package.json': json({ name: 'tool', bin: { tool: 'dist/cli.js' } }), 'dist/cli.js': '' })

    expect(proposal(repo).recipe.entry).toEqual(['node', 'dist/cli.js'])
  })

  it('a `start` that runs the package\'s own bin is the cli again, never an api server', () => {
    const repo = repoOf({
      'package.json': json({
        name: 'filecli',
        bin: { filecli: './dist/cli.js' },
        scripts: { build: 'tsc', start: 'node dist/cli.js' },
      }),
    })

    const out = proposal(repo)
    expect(out.recipe.entry).toEqual(['node', './dist/cli.js'])
    expect(out.recipe.api).toBeUndefined()
  })

  it('bails on several `bin` entries — which one a scenario drives is not deterministic', () => {
    const repo = repoOf({ 'package.json': json({ name: 'tools', bin: { a: 'a.js', b: 'b.js' } }) })

    expect(bail(repo)).toMatch(/several `bin` entries/)
  })

  // A monorepo's ROOT manifest routinely declares no bin — the cli lives in a
  // member. Refusing on sight sent every such repo to the model with only the root
  // package.json to read, which cannot name the package that ships the cli.
  it('derives the cli entry from the ONE workspace member that declares a bin', () => {
    const repo = repoOf({
      'package.json': json({ name: 'mono', workspaces: ['tools/*', 'packages/*'], scripts: { build: 'turbo build' } }),
      'package-lock.json': '{}',
      'tools/cli/package.json': json({ name: 'relkit', bin: { relkit: 'dist/index.js' } }),
      'packages/core/package.json': json({ name: '@mono/core' }),
    })

    const out = proposal(repo)
    // The bin is repo-relative (the entry argv always is), and install/build come
    // from the ROOT, which is where a monorepo builds.
    expect(out.recipe.entry).toEqual(['node', 'tools/cli/dist/index.js'])
    expect(out.recipe.build).toBe('npm run build')
    expect(out.recipe.install).toBeUndefined()
    // A workspace root's `start` is nobody's app — no serve is ever inferred.
    expect(out.recipe.api).toBeUndefined()
  })

  it('reads the member inventory from pnpm-workspace.yaml too', () => {
    const repo = repoOf({
      'package.json': json({ name: 'mono', scripts: { build: 'pnpm -r build' } }),
      'pnpm-workspace.yaml': 'packages:\n  - "tools/*"\n',
      'pnpm-lock.yaml': '',
      'tools/cli/package.json': json({ name: 'relkit', bin: 'bin/relkit.js' }),
    })

    expect(proposal(repo).recipe.entry).toEqual(['node', 'tools/cli/bin/relkit.js'])
  })

  it('bails on a workspace root where NO member declares a bin', () => {
    const repo = repoOf({
      'package.json': json({ name: 'mono', workspaces: ['packages/*'] }),
      'packages/core/package.json': json({ name: '@mono/core' }),
    })

    expect(bail(repo)).toMatch(/no workspace package declares a `bin`/)
  })

  it('bails on a workspace root where SEVERAL members declare a bin, naming them', () => {
    const repo = repoOf({
      'package.json': json({ name: 'mono', workspaces: ['tools/*'] }),
      'tools/a/package.json': json({ name: 'a', bin: 'a.js' }),
      'tools/b/package.json': json({ name: 'b', bin: 'b.js' }),
    })

    const reason = bail(repo)
    expect(reason).toMatch(/2 packages declare a `bin`/)
    expect(reason).toContain('tools/a')
    expect(reason).toContain('tools/b')
  })

  it('bails when a build-less package names a bin/start file that is not there', () => {
    const repo = repoOf({ 'package.json': json({ name: 'svc', bin: 'missing.js', scripts: { start: 'node gone.js' } }) })

    // Nothing produces those files, so the recipe could only fail at verification.
    expect(bail(repo)).toMatch(/neither a usable `bin`/)
  })

  it('bails when an express package has no runnable start script', () => {
    const repo = repoOf({ 'package.json': json({ name: 'svc', dependencies: { express: '^4' } }) })

    expect(bail(repo)).toMatch(/HTTP server but declares no runnable/)
  })
})

// The workspace api derivation (2026-08-20): a monorepo used to punt to the model
// unless exactly one member declared a `bin` — the cal.com failure, where the
// fallback then authored a CLI recipe while the route manifest knew about the Nest
// api. Now the most-routed non-example member with a plain `start` derives.
describe('proposeRecipe — workspace api member', () => {
  const manifestApp = (dir: string, routes: string[], pkg?: string) => ({
    dir,
    ...(pkg ? { pkg } : {}),
    framework: 'nest' as const,
    routes,
    prefixes: routes.map((r) => `/${r.split('/')[1]}`),
    opaque: false,
    pathsShifted: false,
  })

  it('derives the most-routed member as api.serve, workspace-mediated, with its own health route', () => {
    const root = repoOf({
      'package.json': JSON.stringify({ name: 'mono', workspaces: ['apps/*'], scripts: { build: 'turbo build' } , dependencies: { turbo: '2' } }),
      'yarn.lock': '',
      'apps/api/package.json': JSON.stringify({ name: '@mono/api', scripts: { start: 'node dist/main.js' } }),
      'apps/web/package.json': JSON.stringify({ name: '@mono/web', scripts: { start: 'node server.js' } }),
    })
    const res = proposeRecipe(root, {
      manifestApps: [
        manifestApp('apps/api', ['/health', '/v2/bookings', '/v2/slots'], '@mono/api'),
        manifestApp('apps/web', ['/api/auth'], '@mono/web'),
      ],
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.recipe.api).toMatchObject({
      serve: ['yarn', 'workspace', '@mono/api', 'start'],
      app: 'apps/api',
      cwd: 'repo',
      healthPath: '/health',
    })
  })

  it('a routed EXAMPLE app never wins, and a watcher `start` refuses to derive at all', () => {
    const root = repoOf({
      'package.json': JSON.stringify({ name: 'mono', workspaces: ['**'] }),
      'yarn.lock': '',
      'example-apps/demo/package.json': JSON.stringify({ name: 'demo', scripts: { start: 'node s.js' } }),
      'apps/api/package.json': JSON.stringify({ name: '@mono/api', scripts: { start: 'next dev --watch' } }),
    })
    const res = proposeRecipe(root, {
      manifestApps: [
        manifestApp('example-apps/demo', ['/api/getToken', '/a', '/b', '/c'], 'demo'),
        manifestApp('apps/api', ['/health'], '@mono/api'),
      ],
    })
    // The example app is excluded, the real app's start is a watcher — the old
    // punt stands (no bin-declaring member either).
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toMatch(/workspaces/)
  })
})

describe('tokenizeCommand — what is argv and what is a shell', () => {
  const ACCEPTED: [string, string[]][] = [
    ['node dist/index.js', ['node', 'dist/index.js']],
    ['node server.js', ['node', 'server.js']],
    ['node  --enable-source-maps  dist/main.js', ['node', '--enable-source-maps', 'dist/main.js']],
    ['node "dist/my server.js"', ['node', 'dist/my server.js']],
  ]
  for (const [command, argv] of ACCEPTED) {
    it(`accepts a plain invocation — ${command}`, () => {
      expect(tokenizeCommand(command)).toEqual(argv)
    })
  }

  const REFUSED = [
    'npm run build && node dist/index.js',
    'node dist/index.js | tee log',
    'node a.js; node b.js',
    'NODE_ENV=production node dist/index.js',
    'nodemon server.js',
    'node --watch server.js',
    'ts-node-dev src/index.ts',
    'vite dev',
    'next dev',
    'concurrently "npm:api" "npm:web"',
    'npm run start:prod',
    'node server.js > out.log',
    '',
  ]
  for (const command of REFUSED) {
    it(`refuses a non-argv or watch command — ${command || '(empty)'}`, () => {
      expect(tokenizeCommand(command)).toBeNull()
    })
  }
})

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

describe('proposeRecipe — Python', () => {
  const FASTAPI_MAIN = 'from fastapi import FastAPI\n\napp = FastAPI()\n'

  it('derives uvicorn from a declared fastapi dependency + the app assignment', () => {
    const repo = repoOf({
      'pyproject.toml': '[project]\nname = "svc"\ndependencies = ["fastapi>=0.110", "uvicorn"]\n',
      'uv.lock': '',
      'main.py': FASTAPI_MAIN,
    })

    const out = proposal(repo)
    expect(out.ecosystem).toBe('python')
    expect(out.recipe.install).toBe('uv sync')
    expect(out.recipe.build).toBe('true')
    expect(out.recipe.api?.serve).toEqual([
      'python3',
      '-m',
      'uvicorn',
      'main:app',
      // Without `--app-dir` uvicorn imports from the SANDBOX cwd, where the app
      // does not exist; the runner absolutizes the anchored `.` to the repo root.
      '--app-dir',
      '.',
      '--host',
      '127.0.0.1',
      '--port',
      '${PORT}',
    ])
  })

  it('finds the app module one level down, inside an importable package', () => {
    const repo = repoOf({
      'requirements.txt': 'fastapi==0.110.0\nuvicorn\n',
      'app/__init__.py': '',
      'app/main.py': 'from fastapi import FastAPI\n\napi = FastAPI()\n',
    })

    const out = proposal(repo)
    expect(out.recipe.install).toBe('pip install -r requirements.txt')
    // The ATTRIBUTE is read off the assignment — not assumed to be `app`.
    expect(out.recipe.api?.serve).toContain('app.main:api')
  })

  it('bails when two modules both construct a FastAPI app', () => {
    const repo = repoOf({
      'pyproject.toml': '[project]\ndependencies = ["fastapi"]\n',
      'main.py': FASTAPI_MAIN,
      'app/__init__.py': '',
      'app/main.py': FASTAPI_MAIN,
    })

    expect(bail(repo)).toMatch(/several FastAPI apps/)
  })

  it('bails when fastapi is declared but no app assignment is findable', () => {
    const repo = repoOf({ 'pyproject.toml': '[project]\ndependencies = ["fastapi"]\n' })

    expect(bail(repo)).toMatch(/no `app = FastAPI\(…\)` assignment/)
  })

  it('derives flask run from a declared flask dependency', () => {
    const repo = repoOf({
      'pyproject.toml': '[tool.poetry.dependencies]\nflask = "^3.0"\n',
      'poetry.lock': '',
      'app.py': 'from flask import Flask\n\napp = Flask(__name__)\n',
    })

    const out = proposal(repo)
    expect(out.recipe.install).toBe('poetry install')
    expect(out.recipe.api?.serve).toEqual([
      'python3',
      '-m',
      'flask',
      // A FILE path (which the runner absolutizes), not a bare import string —
      // flask has no `--app-dir` and would resolve it against the sandbox cwd.
      '--app',
      'app.py:app',
      'run',
      '--host',
      '127.0.0.1',
      '--port',
      '${PORT}',
    ])
  })

  it('derives django runserver from manage.py, port placeholder and all', () => {
    const repo = repoOf({
      'requirements.txt': 'django==5.0\n',
      'manage.py': '#!/usr/bin/env python\n',
    })

    expect(proposal(repo).recipe.api?.serve).toEqual(['python3', 'manage.py', 'runserver', '127.0.0.1:${PORT}'])
  })

  it('derives a cli entry from a single `__main__.py` package', () => {
    const repo = repoOf({
      'pyproject.toml': '[project]\nname = "tool"\n',
      'tool/__init__.py': '',
      'tool/__main__.py': 'print("hi")\n',
    })

    const out = proposal(repo)
    expect(out.recipe.entry).toEqual(['python3', '-m', 'tool'])
    expect(out.recipe.api).toBeUndefined()
  })

  it('bails on a python repo with no server and no runnable module', () => {
    const repo = repoOf({ 'pyproject.toml': '[project]\nname = "lib"\n' })

    expect(bail(repo)).toMatch(/not deterministic/)
  })
})

// ---------------------------------------------------------------------------
// C# / .NET
// ---------------------------------------------------------------------------

describe('proposeRecipe — C#', () => {
  it('derives an api recipe from a web-SDK csproj, binding Kestrel to the run port', () => {
    const repo = repoOf({
      'src/Api/Api.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web">\n  <PropertyGroup></PropertyGroup>\n</Project>\n',
    })

    const out = proposal(repo)
    expect(out.ecosystem).toBe('dotnet')
    // `dotnet restore` folds into the build — no install step.
    expect(out.recipe.install).toBeUndefined()
    expect(out.recipe.build).toBe('dotnet build -c Release src/Api/Api.csproj')
    expect(out.recipe.api?.serve).toEqual([
      'dotnet',
      'run',
      '--project',
      'src/Api/Api.csproj',
      '--no-build',
      '-c',
      'Release',
    ])
    // `PORT` means nothing to Kestrel; ASPNETCORE_URLS is what it binds.
    expect(out.recipe.api?.env).toEqual({ ASPNETCORE_URLS: 'http://127.0.0.1:${PORT}' })
  })

  it('derives a cli entry from a console-app csproj', () => {
    const repo = repoOf({
      'Tool.csproj': '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup><OutputType>Exe</OutputType></PropertyGroup>\n</Project>\n',
    })

    const out = proposal(repo)
    expect(out.recipe.entry).toEqual(['dotnet', 'run', '--project', 'Tool.csproj', '--no-build', '-c', 'Release'])
    expect(out.recipe.api).toBeUndefined()
  })

  it('bails on a library csproj — neither a server nor an entrypoint', () => {
    const repo = repoOf({ 'Lib.csproj': '<Project Sdk="Microsoft.NET.Sdk"></Project>\n' })

    expect(bail(repo)).toMatch(/neither a web SDK project nor an/)
  })

  it('bails on a multi-project solution', () => {
    const repo = repoOf({
      'src/Api/Api.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>',
      'src/Worker/Worker.csproj': '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType></PropertyGroup></Project>',
    })

    expect(bail(repo)).toMatch(/2 \.csproj files/)
  })
})

// ---------------------------------------------------------------------------
// Ecosystem arbitration
// ---------------------------------------------------------------------------

describe('proposeRecipe — ecosystem arbitration', () => {
  it('bails when two ecosystems declare themselves at the root', () => {
    const repo = repoOf({
      'package.json': json({ name: 'svc', scripts: { start: 'node server.js' } }),
      'server.js': '',
      'pyproject.toml': '[project]\ndependencies = ["fastapi"]\n',
      'main.py': 'from fastapi import FastAPI\napp = FastAPI()\n',
    })

    expect(bail(repo)).toMatch(/multiple ecosystems/)
  })

  it('bails on a repo with no manifest at all', () => {
    expect(bail(repoOf({ 'README.md': '# hi' }))).toMatch(/no package.json/)
  })
})

// ---------------------------------------------------------------------------
// Health-path ranking
// ---------------------------------------------------------------------------

describe('health-path ranking', () => {
  it('prefers the highest-ranked route that ACTUALLY exists', () => {
    expect(rankHealthPath([{ method: 'GET', path: '/health' }, { method: 'GET', path: '/healthz' }])).toBe('/healthz')
    expect(rankHealthPath([{ method: 'GET', path: '/ping' }, { method: 'GET', path: '/readyz' }])).toBe('/readyz')
  })

  it('never ranks a non-GET route — a health poll is a GET', () => {
    expect(rankHealthPath([{ method: 'POST', path: '/healthz' }])).toBeUndefined()
  })

  it('omits the health path when the surface declares no health route', () => {
    expect(rankHealthPath([{ method: 'GET', path: '/todos' }])).toBeUndefined()
  })

  it('lands in the proposal only when the route surface carries it', () => {
    const files = {
      'package.json': json({ name: 'svc', scripts: { start: 'node server.js' } }),
      'server.js': '',
    }
    const withHealth = proposal(repoOf(files), [
      { method: 'GET', path: '/todos' },
      { method: 'GET', path: '/healthz' },
    ])
    const without = proposal(repoOf(files), [{ method: 'GET', path: '/todos' }])

    expect(withHealth.recipe.api?.healthPath).toBe('/healthz')
    // Absent, not guessed: an invented health path would 404 and fail every boot.
    expect(without.recipe.api?.healthPath).toBeUndefined()
  })

  it('reads the surface off operation-rooted journeys', () => {
    const routes = routesFromInterfaces([
      { id: 'api/get-health', title: 'GET /healthz', type: 'api', entry: { method: 'GET', path: '/healthz' }, steps: [], fingerprint: 'f1' },
      { id: 'cli/tool', title: 'tool', type: 'cli', entry: { command: ['tool'] }, steps: [], fingerprint: 'f2' },
    ] as never)

    expect(routes).toEqual([{ method: 'GET', path: '/healthz' }])
  })
})

// ---------------------------------------------------------------------------
// docker-compose services
// ---------------------------------------------------------------------------

describe('compose services', () => {
  it('proposes up/down when the root compose file declares a datastore', () => {
    const repo = repoOf({
      'package.json': json({ name: 'svc', scripts: { start: 'node server.js' } }),
      'server.js': '',
      'docker-compose.yml': 'services:\n  db:\n    image: postgres:16\n  api:\n    build: .\n',
    })

    expect(proposal(repo).recipe.api?.services).toEqual({
      up: 'docker compose up -d --wait',
      down: 'docker compose down',
      reset: 'docker compose down -v',
    })
  })

  it('proposes nothing for a compose file with no datastore image', () => {
    const repo = repoOf({
      'package.json': json({ name: 'svc', scripts: { start: 'node server.js' } }),
      'server.js': '',
      'docker-compose.yml': 'services:\n  api:\n    build: .\n',
    })

    expect(proposal(repo).recipe.api?.services).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Credential stubs from OpenAPI security schemes
// ---------------------------------------------------------------------------

describe('credential stubs', () => {
  it('maps an apiKey-in-header scheme onto its header, sourced from a named env var', () => {
    const { credentials, notes } = credentialStubs({ apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-Api-Key' } })

    expect(credentials?.apiKeyAuth).toMatchObject({
      header: 'X-Api-Key',
      valueFromEnv: 'GUARD_CRED_APIKEYAUTH',
      satisfies: 'apiKeyAuth',
    })
    // The stub is honest about being a stub — never a fabricated secret.
    expect(credentials?.apiKeyAuth.description).toMatch(/^TODO: fill in/)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('GUARD_CRED_APIKEYAUTH')
  })

  it('maps an http bearer scheme onto Authorization, and says so in the TODO', () => {
    const { credentials, notes } = credentialStubs({ bearerAuth: { type: 'http', scheme: 'bearer' } })

    expect(credentials?.bearerAuth).toMatchObject({ header: 'Authorization', satisfies: 'bearerAuth' })
    expect(notes[0]).toMatch(/Bearer /)
  })

  it('stubs nothing for a scheme no header carries — it reports it instead', () => {
    const { credentials, notes } = credentialStubs({
      oauth: { type: 'oauth2' },
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'session' },
    })

    expect(credentials).toBeUndefined()
    expect(notes).toHaveLength(2)
    expect(notes[0]).toMatch(/"oauth" \(oauth2\) has no request-header form/)
    expect(notes[1]).toMatch(/"cookieAuth" \(apiKey in cookie\) has no request-header form/)
  })

  it('derives a predictable env-var name from any scheme key', () => {
    expect(credentialEnvName('api-key.v2')).toBe('GUARD_CRED_API_KEY_V2')
  })

  it('rides into the proposal, with its TODOs reported alongside', () => {
    const repo = repoOf({
      'package.json': json({ name: 'svc', scripts: { start: 'node server.js' } }),
      'server.js': '',
    })

    const outcome = proposeRecipe(repo, {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' }, oauth: { type: 'oauth2' } },
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(Object.keys(outcome.recipe.api?.credentials ?? {})).toEqual(['bearerAuth'])
    expect(outcome.todos).toHaveLength(2)
  })

  it('reads the schemes off the corpus OpenAPI doc when none are passed in', () => {
    const repo = repoOf({
      'package.json': json({ name: 'svc', scripts: { start: 'node server.js' } }),
      'server.js': '',
      'openapi.yaml': [
        'openapi: 3.0.0',
        'info: { title: svc, version: "1" }',
        'paths: {}',
        'components:',
        '  securitySchemes:',
        '    apiKeyAuth:',
        '      type: apiKey',
        '      in: header',
        '      name: X-Api-Key',
      ].join('\n'),
      '.truecourse/specs/corpus.json': json({ version: 3, docs: [{ ref: 'openapi.yaml', areaTags: [] }] }),
    })

    const outcome = proposeRecipe(repo)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.recipe.api?.credentials?.apiKeyAuth.header).toBe('X-Api-Key')
  })
})

// ---------------------------------------------------------------------------
// The acceptance shape: the `speced-api` sample repo, reproduced
// ---------------------------------------------------------------------------

describe('the speced-api shape', () => {
  it('reproduces the hand-written recipe byte for byte', () => {
    const repo = repoOf({
      'package.json': json({
        name: 'speced-api',
        version: '1.0.0',
        dependencies: { express: '^4.19.2' },
        scripts: {
          build: 'tsc -p tsconfig.json',
          start: 'node dist/index.js',
          dev: 'node --watch dist/index.js',
        },
      }),
      'package-lock.json': json({ name: 'speced-api', lockfileVersion: 3 }),
    })

    const out = proposal(repo, [
      { method: 'GET', path: '/healthz' },
      { method: 'GET', path: '/forecast' },
      { method: 'POST', path: '/subscriptions' },
    ])

    expect(out.recipe).toEqual({
      install: 'npm ci',
      build: 'npm run build',
      api: { serve: ['node', 'dist/index.js'], healthPath: '/healthz' },
    })
  })
})
