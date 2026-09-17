/**
 * Which app the derived `web` block points at, and which page it addresses.
 *
 * The api half crowns the MOST-ROUTED workspace member, which in an api+web
 * monorepo is the api server — pointing the web block at that argv boots a
 * second copy of the api and asks it for a page it does not serve. The block
 * belongs to the app the browser evidence came from, or nowhere: an undecidable
 * surface leaves the static "declare a `web` block" complaint standing, which a
 * repair session can act on before anything is installed or built.
 *
 * The page lookup reads the framework's own address rules (`@truecourse/shared`),
 * so a parallel slot proves nothing and a `+`-grouped flat route proves itself.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { proposeRecipe, staticProposalComplaints, type RecipeAppInventoryEntry } from '@truecourse/guard-generator'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})

const json = (value: unknown) => JSON.stringify(value, null, 2)

function repoOf(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-web-derive-'))
  dirs.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  return dir
}

const manifestApp = (dir: string, pkg: string, framework: 'next' | 'remix' | 'other', routes: string[]) => ({
  dir,
  pkg,
  framework,
  routes,
  prefixes: [],
  opaque: false,
  pathsShifted: false,
})

/** An Express api with many routes plus a Next web app — the api wins the api
 *  block, and the web block must not follow it. */
const API_PLUS_WEB = [
  manifestApp('apps/api', '@mono/api', 'other', ['/v1/users', '/v1/orders', '/v1/items', '/health']),
  manifestApp('apps/web', '@mono/web', 'next', ['/api/me']),
]

function apiPlusWebRepo(extra: Record<string, string>, webScripts: Record<string, string> = { start: 'next start' }) {
  return repoOf({
    'package.json': json({ name: 'mono', workspaces: ['apps/*'] }),
    'pnpm-lock.yaml': '',
    'apps/api/package.json': json({ name: '@mono/api', scripts: { start: 'node dist/main.js' } }),
    'apps/web/package.json': json({ name: '@mono/web', dependencies: { next: '15.0.0' }, scripts: webScripts }),
    ...extra,
  })
}

function proposeApiPlusWeb(repo: string) {
  const out = proposeRecipe(repo, { manifestApps: API_PLUS_WEB })
  if (!out.ok) throw new Error(`expected a proposal, got a bail: ${out.reason}`)
  return out.recipe
}

describe('the derived web block — which app it serves', () => {
  it('serves the browser app, not the most-routed api member', () => {
    const recipe = proposeApiPlusWeb(
      apiPlusWebRepo({ 'apps/web/app/login/page.tsx': 'export default function Login() {}' }),
    )

    expect(recipe.api?.app).toBe('apps/api')
    expect(recipe.web).toMatchObject({
      serve: ['pnpm', '--filter', '@mono/web', 'run', 'start'],
      app: 'apps/web',
      cwd: 'repo',
      healthPath: '/login',
    })
  })

  it('derives no block when the browser app ships only a watcher, leaving the static complaint standing', () => {
    const repo = apiPlusWebRepo({ 'apps/web/app/login/page.tsx': 'export default function Login() {}' }, { dev: 'next dev' })
    const recipe = proposeApiPlusWeb(repo)

    expect(recipe.web).toBeUndefined()
    const apps: RecipeAppInventoryEntry[] = [
      { dir: 'apps/api', pkg: '@mono/api', framework: 'other', prefixes: ['/v1'] },
      { dir: 'apps/web', pkg: '@mono/web', framework: 'next', prefixes: ['/api'] },
    ]
    const complaints = staticProposalComplaints({ build: recipe.build, api: recipe.api }, apps, repo)
    expect(complaints.some((c) => c.includes('no `web` block'))).toBe(true)
  })
})

describe('the derived web block — the page it addresses', () => {
  /** A pnpm monorepo whose only routed member is the browser app. */
  const soloWebRepo = (framework: 'next' | 'remix', pages: Record<string, string>) => {
    const repo = repoOf({
      'package.json': json({ name: 'mono', workspaces: ['apps/*'] }),
      'pnpm-lock.yaml': '',
      'apps/web/package.json': json({ name: '@mono/web', scripts: { start: 'node server.js' } }),
      ...pages,
    })
    const out = proposeRecipe(repo, { manifestApps: [manifestApp('apps/web', '@mono/web', framework, ['/login'])] })
    if (!out.ok) throw new Error(`expected a proposal, got a bail: ${out.reason}`)
    return out.recipe
  }

  it('does not read a page behind a parallel slot as an address', () => {
    // `@modal` is a slot: `/login` is rendered INTO another route, never served.
    const recipe = soloWebRepo('next', { 'apps/web/app/@modal/login/page.tsx': 'export default function Login() {}' })

    expect(recipe.web?.healthPath).toBe('/')
  })

  it('reads a flat route grouped in a `+` folder', () => {
    const recipe = soloWebRepo('remix', {
      'apps/web/app/routes/_unauthenticated+/signin.tsx': 'export default function In() {}',
    })

    expect(recipe.web?.healthPath).toBe('/signin')
  })

  it('reads the folder form of a flat route', () => {
    // `signin/route.tsx` addresses exactly what `signin.tsx` does.
    const recipe = soloWebRepo('remix', {
      'apps/web/app/routes/signin/route.tsx': 'export default function In() {}',
    })

    expect(recipe.web?.healthPath).toBe('/signin')
  })

  it('ignores a module colocated in a plain folder', () => {
    const recipe = soloWebRepo('remix', {
      'apps/web/app/routes/components/signin.tsx': 'export function SignIn() {}',
    })

    expect(recipe.web?.healthPath).toBe('/')
  })
})
