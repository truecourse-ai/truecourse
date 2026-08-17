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
  apiScenario,
  makeTempRepo,
  rmrf,
  scenario,
  specBinds,
  writeRecipe,
  writeScenario,
  writeSpecDoc,
  FIXTURE_API_SERVER,
  FIXTURE_BIN,
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

/**
 * THE PREPARED WORLD (item 98). `api.services.up` and `api.seed` prepare the world
 * the RUN shares — the datastore behind the app and the rows in it — and that world
 * used to be gated on the api pool alone: `guard run --scenario <a web one>` started
 * no services and seeded nothing, so every `{{fixture:…}}` in it settled the "the
 * seed did not run for this selection" error. The gate now asks the same question
 * the per-driver gate above asks — what does this selection NEED — and the economy
 * it protects is the other half: a cli-only selection must still start no docker.
 */
describe('the prepared world (services + seed)', () => {
  /** The marker a run of the recipe's `services.up` leaves in the repo. */
  const SERVICES_LOG = 'services-up.log'
  /** The marker a run of the recipe's `seed` leaves in the repo. */
  const SEED_LOG = 'seed-ran.log'
  /** The one field the fixture seed publishes — 12 bytes, so the page's report is exact. */
  const SEEDED_TEXT = 'seeded-hello'

  /**
   * A repo whose recipe declares BOTH surfaces (a cli entry, a served web app) and a
   * shared world (services + seed). Every command is a node script that appends a
   * marker, so "did it run for this selection" is a file-existence question.
   */
  function makeWorldRepo(): string {
    const repo = makeTempRepo()
    repos.push(repo)
    const marker = (log: string): string =>
      `import fs from 'node:fs'\nimport path from 'node:path'\nfs.appendFileSync(path.join(process.cwd(), '${log}'), 'ran\\n')\n`
    fs.writeFileSync(path.join(repo, 'services-up.mjs'), marker(SERVICES_LOG))
    fs.writeFileSync(path.join(repo, 'services-down.mjs'), marker('services-down.log'))
    fs.writeFileSync(
      path.join(repo, 'seed.mjs'),
      `${marker(SEED_LOG)}fs.writeFileSync(process.env.GUARD_SEED_OUT, JSON.stringify({ fixtures: { doc: { text: '${SEEDED_TEXT}' } } }))\n`,
    )
    const recipe = {
      build: 'true',
      entry: ['node', FIXTURE_BIN],
      web: { serve: ['node', FIXTURE_WEB_SERVER], healthPath: '/health', readyTimeoutMs: 20_000 },
      api: {
        serve: ['node', FIXTURE_API_SERVER],
        healthPath: '/health',
        services: { up: 'node services-up.mjs', down: 'node services-down.mjs' },
        seed: { command: 'node seed.mjs', provides: { fixtures: { doc: ['text'] } } },
      },
    }
    const target = path.join(repo, '.truecourse', 'scenarios', 'recipe.json')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, JSON.stringify(recipe, null, 2))
    writeSpecDoc(repo)
    // The four selections this suite runs one at a time.
    writeScenario(
      repo,
      'web/upload.yaml',
      scenario({
        id: 'web-fixture',
        binds: specBinds('spec/section'),
        steps: [
          { driver: 'web', navigate: '/upload' },
          {
            driver: 'web',
            upload: { role: 'button', name: 'Choose a file' },
            file: { text: '{{fixture:doc.text}}', as: 'seeded.txt' },
            expect: {
              text: { contains: `hidden: seeded.txt · 12 bytes · text/plain · ${SEEDED_TEXT}` },
            },
          },
        ],
      }),
    )
    writeScenario(
      repo,
      'cli/plain.yaml',
      scenario({
        id: 'cli-plain',
        binds: specBinds('cli/version'),
        steps: [{ run: ['--version'], expect: { exit: 0 } }],
      }),
    )
    writeScenario(
      repo,
      'cli/fixture.yaml',
      scenario({
        id: 'cli-fixture',
        binds: specBinds('cli/version'),
        steps: [
          {
            run: ['note', 'f.txt', '{{fixture:doc.text}}'],
            expect: { exit: 0, files: { 'f.txt': { equals: SEEDED_TEXT } } },
          },
        ],
      }),
    )
    writeScenario(
      repo,
      'api/todos.yaml',
      apiScenario({
        id: 'api-todos',
        binds: specBinds('spec/section'),
        steps: [{ request: { method: 'GET', path: '/todos' }, expect: { status: 200 } }],
      }),
    )
    return repo
  }

  /** Did the recipe's `services.up` / `seed` run during that selection? */
  const ran = (repo: string, log: string): boolean => fs.existsSync(path.join(repo, log))

  it(
    'a WEB-only selection gets the seeded world, and its `{{fixture:…}}` resolves',
    async () => {
      expect(
        await isBrowserInstalled(),
        'playwright-core + chromium must be installed for this suite',
      ).toBe(true)
      const r = makeWorldRepo()
      const res = await runGuard({ repoRoot: r, scenarioId: 'web-fixture', skipBuild: true })
      if (res.status !== 'ok') throw new Error(`expected ok, got ${res.status}`)
      const only = res.latest.scenarios[0]
      expect(only.failure?.actual ?? '').not.toContain('the seed did not run for this selection')
      expect(only.outcome).toBe('pass')
      expect(ran(r, SERVICES_LOG), 'services.up must run for a web selection').toBe(true)
      expect(ran(r, SEED_LOG), 'the seed must run for a web selection').toBe(true)
    },
    TEST_TIMEOUT_MS,
  )

  it('a CLI-only selection that reads a fixture gets the seeded world too', async () => {
    const r = makeWorldRepo()
    const res = await runGuard({ repoRoot: r, scenarioId: 'cli-fixture', skipBuild: true })
    if (res.status !== 'ok') throw new Error(`expected ok, got ${res.status}`)
    const only = res.latest.scenarios[0]
    expect(only.failure?.actual ?? '').not.toContain('the seed did not run for this selection')
    expect(only.outcome).toBe('pass')
    expect(ran(r, SEED_LOG), 'the seed must run when a step reads a fixture').toBe(true)
  })

  it('a CLI-only selection that needs NOTHING starts no services and runs no seed', async () => {
    const r = makeWorldRepo()
    const res = await runGuard({ repoRoot: r, scenarioId: 'cli-plain', skipBuild: true })
    if (res.status !== 'ok') throw new Error(`expected ok, got ${res.status}`)
    expect(res.latest.scenarios[0].outcome).toBe('pass')
    expect(ran(r, SERVICES_LOG), 'a cli-only selection must not start docker').toBe(false)
    expect(ran(r, SEED_LOG), 'a cli-only selection must not seed').toBe(false)
  })

  it(
    'an API selection prepares the world exactly as it always did',
    async () => {
      const r = makeWorldRepo()
      const res = await runGuard({ repoRoot: r, scenarioId: 'api-todos', skipBuild: true })
      if (res.status !== 'ok') throw new Error(`expected ok, got ${res.status}`)
      expect(res.latest.scenarios[0].outcome).toBe('pass')
      expect(ran(r, SERVICES_LOG)).toBe(true)
      expect(ran(r, SEED_LOG)).toBe(true)
    },
    TEST_TIMEOUT_MS,
  )
})
