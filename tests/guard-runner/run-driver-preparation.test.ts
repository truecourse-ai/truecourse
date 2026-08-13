/**
 * THE PER-DRIVER PREPARATION GATE — what a scenario NEEDS decides what the
 * recipe must declare. There is no driver tag to consult: the execution path is
 * derived from the STEPS (`isApiServerScenario`), and preparation follows it.
 *
 * A sandbox scenario holds cli, web and `request` steps in one list. A web-only
 * product (cal.com) has no CLI: its recipe declares `web` (and an `api` block)
 * with no `entry`, and a sandbox scenario whose steps never invoke the entry must
 * run. Conversely a scenario that DOES `run:` still refuses without `entry`, and a
 * browser scenario without a `web` surface settles the same honest unprepared error
 * instead of failing mid-flight — as does an all-request scenario, which takes the
 * api-SERVER path and so needs the `api` block.
 */

import { describe, expect, it, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { runGuard, isBrowserInstalled } from '@truecourse/guard-runner'
import {
  makeTempRepo,
  rmrf,
  scenario,
  specBinds,
  writeRecipe,
  writeScenario,
  writeSpecDoc,
} from './helpers.js'

/** The dependency-free fixture web app the web-driver suite already proves. */
const FIXTURE_WEB_SERVER = fileURLToPath(
  new URL('../fixtures/guard-fixture-web/server.mjs', import.meta.url),
)

/** A browser boot is a real browser: generous, but bounded. */
const TEST_TIMEOUT_MS = 60_000

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

/** A repo whose recipe has NO `entry` — an api block (never booted here) and, optionally, a web surface. */
function makeEntrylessRepo(overrides: { withWeb?: boolean } = {}): string {
  const repo = makeTempRepo()
  repos.push(repo)
  const recipe = {
    build: 'true',
    api: {
      serve: ['node', '-e', 'setInterval(() => {}, 1000)'],
      healthPath: '/health',
    },
    ...(overrides.withWeb
      ? {
          web: {
            serve: ['node', FIXTURE_WEB_SERVER],
            healthPath: '/health',
            readyTimeoutMs: 20_000,
          },
        }
      : {}),
  }
  const target = path.join(repo, '.truecourse', 'scenarios', 'recipe.json')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(recipe, null, 2))
  writeSpecDoc(repo)
  return repo
}

describe('the per-driver preparation gate', () => {
  it(
    'a web-only cli scenario RUNS on an entryless recipe that declares a web surface',
    async () => {
      expect(
        await isBrowserInstalled(),
        'playwright-core + chromium must be installed for this suite',
      ).toBe(true)
      const r = makeEntrylessRepo({ withWeb: true })
      writeScenario(
        r,
        'web/only.yaml',
        scenario({
          id: 'webonly',
          binds: specBinds('spec/section'),
          steps: [
            {
              driver: 'web',
              navigate: '/',
              expect: { text: { contains: 'Guard Web Fixture' } },
              milestone: 1,
            },
          ],
        }),
      )
      const res = await runGuard({ repoRoot: r, skipBuild: true })
      if (res.status !== 'ok') throw new Error(`expected ok, got ${res.status}`)
      const only = res.latest.scenarios[0]
      expect(only.outcome).toBe('pass')
    },
    TEST_TIMEOUT_MS,
  )

  it('a run-step scenario still refuses without `entry`, naming it', async () => {
    const r = makeEntrylessRepo({ withWeb: true })
    writeScenario(
      r,
      'cli/runs.yaml',
      scenario({
        id: 'runs',
        binds: specBinds('spec/section'),
        steps: [{ run: ['--version'], expect: { exit: 0 } }],
      }),
    )
    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error(`expected ok, got ${res.status}`)
    const runs = res.latest.scenarios[0]
    expect(runs.outcome).toBe('error')
    expect(runs.failure?.actual).toContain('`entry`')
  })

  it('a web-only scenario without a web surface settles unprepared naming `web`, not `entry`', async () => {
    const r = makeEntrylessRepo({ withWeb: false })
    writeScenario(
      r,
      'web/lost.yaml',
      scenario({
        id: 'lost',
        binds: specBinds('spec/section'),
        steps: [
          { driver: 'web', navigate: '/', expect: { text: { contains: 'anything' } }, milestone: 1 },
        ],
      }),
    )
    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error(`expected ok, got ${res.status}`)
    const lost = res.latest.scenarios[0]
    expect(lost.outcome).toBe('error')
    expect(lost.failure?.actual).toContain('`web`')
    expect(lost.failure?.actual).not.toContain('`entry`')
  })
  it('the execution path comes from the STEPS: all-request takes the api server, a mix takes the sandbox', async () => {
    // A cli-only recipe: an `entry`, no `api` block, no `web` surface. Each
    // scenario then names the preparation of the path it actually took, which is
    // the whole observable difference between the two.
    const r = makeTempRepo()
    repos.push(r)
    writeRecipe(r)
    writeScenario(
      r,
      'api/only.yaml',
      scenario({
        id: 'requests-only',
        binds: specBinds('spec/section'),
        steps: [{ request: { method: 'GET', path: '/' }, expect: { status: 200 } }],
      }),
    )
    writeScenario(
      r,
      'api/mixed.yaml',
      scenario({
        id: 'mixed',
        binds: specBinds('spec/section'),
        steps: [
          { run: ['--version'], expect: { exit: 0 } },
          { request: { method: 'GET', path: '/' }, expect: { status: 200 } },
        ],
      }),
    )
    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error(`expected ok, got ${res.status}`)
    const byId = new Map(res.latest.scenarios.map((s) => [s.id, s]))
    // Every step an api verb ⇒ the api-SERVER path, which needs the `api` block.
    expect(byId.get('requests-only')?.outcome).toBe('error')
    expect(byId.get('requests-only')?.failure?.actual).toContain('`api` block')
    // One cli step in the list ⇒ the SANDBOX path, whose request step is sent to
    // the served surface — so what it lacks is `web`, not an api server.
    expect(byId.get('mixed')?.outcome).toBe('error')
    expect(byId.get('mixed')?.failure?.actual).toContain('`web`')
    expect(byId.get('mixed')?.failure?.actual).not.toContain('`api` block')
  })
})
