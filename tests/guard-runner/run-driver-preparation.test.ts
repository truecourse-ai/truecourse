/**
 * THE PER-DRIVER PREPARATION GATE — what a scenario NEEDS decides what the
 * recipe must declare, not the scenario's driver tag.
 *
 * A `driver: cli` file is the sandbox scenario, and web steps live INSIDE it.
 * A web-only product (cal.com) has no CLI: its recipe declares `web` (and an
 * `api` block) with no `entry`, and a cli scenario whose steps never invoke
 * the entry must run. Conversely a scenario that DOES `run:` still refuses
 * without `entry`, and a browser scenario without a `web` surface settles the
 * same honest unprepared error instead of failing mid-flight.
 */

import { describe, expect, it, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { runGuard, isBrowserInstalled } from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, scenario, specBinds, writeScenario, writeSpecDoc } from './helpers.js'

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
})
