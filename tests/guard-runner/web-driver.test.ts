/**
 * The WEB DRIVER, end to end in a real browser, against `guard-fixture-web` — a
 * two-page dependency-free app, NOT the dashboard: these tests must be hermetic and
 * fast, and the real dashboard is proved separately.
 *
 * What each block is really asserting:
 *  - the verbs work (navigate / click / fill / assert on text and address);
 *  - a missed target FAILS by name, with the page's own state as evidence;
 *  - waiting is on OBSERVABLE STATE — the slow page proves the wait, not a sleep;
 *  - a MIXED scenario is one world: a cli step writes what the browser then sees;
 *  - the same `${…}` tokens mean the same thing on both surfaces;
 *  - NOTHING outlives a scenario — no server, no browser, checked against `ps`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import type { GuardCliScenario, GuardSandboxStep } from '@truecourse/shared'
import {
  isBrowserInstalled,
  loadRecipe,
  newRunNonce,
  openWebSession,
  resolveWebSurface,
  runScenario,
  scenarioUnique,
  WEB_VIDEO_FILE,
  type ResolvedWebSurface,
} from '@truecourse/guard-runner'
import { FIXTURE_BIN, makeTempRepo, rmrf, scenario, specBinds, writeSpecDoc } from './helpers.js'

/** Absolute path to the fixture WEB app (two linked pages, a button, a text change). */
const FIXTURE_WEB_SERVER = fileURLToPath(
  new URL('../fixtures/guard-fixture-web/server.mjs', import.meta.url),
)

/** A browser step is a real browser: generous, but still bounded. */
const TEST_TIMEOUT_MS = 60_000

/**
 * The chromium processes Playwright has running RIGHT NOW, by pid. Read from the
 * OS, not from our own bookkeeping — the point of an orphan check is to distrust
 * the bookkeeping. A browser Playwright launched is the only thing on the machine
 * whose argv carries both the ms-playwright cache path and a `--user-data-dir`.
 */
function playwrightBrowserPids(): number[] {
  return execFileSync('ps', ['-Ao', 'pid=,args='])
    .toString()
    .split('\n')
    .filter((line) => line.includes('/ms-playwright/') && line.includes('--user-data-dir='))
    .map((line) => Number(line.trim().split(/\s+/)[0]))
    .filter((pid) => Number.isInteger(pid))
}

/** True while the process is alive (signal 0 probes without delivering anything). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

interface WebRecipeOverrides {
  healthPath?: string
  readyTimeoutMs?: number
  env?: Record<string, string>
  /** Write NO web block — the "recipe does not declare a web surface" case. */
  omitWeb?: boolean
}

/** A repo whose recipe runs `relkit` and serves the fixture web app. */
function makeWebRepo(overrides: WebRecipeOverrides = {}): string {
  const repo = makeTempRepo()
  const recipe = {
    build: 'true',
    entry: ['node', FIXTURE_BIN],
    ...(overrides.omitWeb
      ? {}
      : {
          web: {
            serve: ['node', FIXTURE_WEB_SERVER],
            healthPath: overrides.healthPath ?? '/health',
            readyTimeoutMs: overrides.readyTimeoutMs ?? 20_000,
            ...(overrides.env ? { env: overrides.env } : {}),
          },
        }),
  }
  const target = path.join(repo, '.truecourse', 'scenarios', 'recipe.json')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(recipe, null, 2))
  writeSpecDoc(repo)
  return repo
}

/** The recipe's resolved web surface, read back through the real recipe loader. */
function webSurfaceOf(repo: string): ResolvedWebSurface | null {
  const loaded = loadRecipe(repo, path.join(repo, '.truecourse', 'scenarios', 'recipe.json'))
  if (!loaded) throw new Error('the fixture recipe did not load')
  return resolveWebSurface(loaded.recipe)
}

/** Run one scenario in its own sandbox, with the fixture recipe's web surface. */
async function run(repo: string, steps: GuardSandboxStep[], id = 'web.flow.cli.1') {
  const s: GuardCliScenario = scenario({ id, steps, binds: specBinds('a/b') })
  const surface = webSurfaceOf(repo)
  return await runScenario(s, {
    repoRoot: repo,
    runId: 'run-web',
    resolvedEntry: ['node', FIXTURE_BIN],
    unique: scenarioUnique(newRunNonce(), s.id),
    stepTimeoutMs: 20_000,
    capturePassEvidence: true,
    ...(surface ? { web: surface } : {}),
  })
}

/** The evidence directory a run of `id` left behind. */
function evidenceDir(repo: string, id = 'web.flow.cli.1'): string {
  return path.join(repo, '.truecourse', 'guard', 'evidence', 'run-web', id)
}

/** The transcript of that run. */
function transcript(repo: string, id = 'web.flow.cli.1'): string {
  return fs.readFileSync(path.join(evidenceDir(repo, id), 'transcript.txt'), 'utf-8')
}

describe('the web driver', () => {
  let repo: string
  let pidsBefore: number[]

  beforeAll(async () => {
    // The suite is meaningless without the browser, and skipping silently would be
    // the "green for the wrong reason" this whole engine exists to prevent.
    expect(
      await isBrowserInstalled(),
      'playwright-core + chromium must be installed for the web driver suite',
    ).toBe(true)
    pidsBefore = playwrightBrowserPids()
    repo = makeWebRepo()
  })

  afterAll(() => {
    rmrf(repo)
  })

  it(
    'navigates and asserts on visible text and the address',
    async () => {
      const result = await run(repo, [
        { driver: 'web', navigate: '/', expect: { text: { contains: 'Guard Web Fixture' } } },
        {
          driver: 'web',
          expect: { url: { equals: '/' }, visible: { role: 'button', name: 'Reveal' } },
          milestone: 1,
        },
      ])
      expect(result.outcome).toBe('pass')
      const text = transcript(repo)
      expect(text).toContain('navigate /')
      expect(text).toContain('at:       /')
      expect(text).toContain('Guard Web Fixture')
      // Every web step leaves its screenshot, pass included.
      expect(fs.existsSync(path.join(evidenceDir(repo), 'step-1.png'))).toBe(true)
      expect(fs.existsSync(path.join(evidenceDir(repo), 'step-2.png'))).toBe(true)
      // …and the session leaves its video.
      expect(fs.existsSync(path.join(evidenceDir(repo), WEB_VIDEO_FILE))).toBe(true)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'clicks a link (navigation) and a button (an in-page text change)',
    async () => {
      const result = await run(repo, [
        { driver: 'web', navigate: '/' },
        {
          driver: 'web',
          click: { role: 'button', name: 'Reveal' },
          expect: { text: { contains: 'the secret is out' } },
        },
        {
          driver: 'web',
          click: { role: 'link', name: 'Notes' },
          expect: { url: { equals: '/notes' }, visible: { role: 'heading', name: 'Notes' } },
        },
      ])
      expect(result.outcome).toBe('pass')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'fills an input addressed by its label and submits it',
    async () => {
      const result = await run(repo, [
        { driver: 'web', navigate: '/' },
        { driver: 'web', fill: { role: 'textbox', name: 'Title' }, value: 'release notes' },
        {
          driver: 'web',
          click: { role: 'button', name: 'Save' },
          expect: { url: { contains: '/notes?title=release' }, text: { contains: 'title: release notes' } },
        },
      ])
      expect(result.outcome).toBe('pass')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'a target that never appears FAILS by name, with the page state as evidence',
    async () => {
      const result = await run(repo, [
        { driver: 'web', navigate: '/' },
        { driver: 'web', click: { role: 'button', name: 'Publish' }, timeoutMs: 1_500 },
      ])
      // A missing control is DRIFT, not infrastructure.
      expect(result.outcome).toBe('fail')
      expect(result.failure?.step).toBe(2)
      expect(result.failure?.expected).toContain('button “Publish”')
      expect(result.failure?.actual).toContain('no button named “Publish” is on the page')
      // The evidence names what IS there — the answer is usually "it is called
      // something else now".
      const diff = fs.readFileSync(path.join(evidenceDir(repo), 'diff.txt'), 'utf-8')
      expect(diff).toContain('Reveal')
      expect(diff).toContain('Save')
      expect(diff).toContain('visible page text')
      // The failing step's screenshot is written like any other step's.
      expect(fs.existsSync(path.join(evidenceDir(repo), 'step-2.png'))).toBe(true)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'an unmet address assertion fails naming both addresses',
    async () => {
      const result = await run(repo, [
        { driver: 'web', navigate: '/notes', expect: { url: { equals: '/somewhere-else' } }, timeoutMs: 1_500 },
      ])
      expect(result.outcome).toBe('fail')
      expect(result.failure?.expected).toContain('the address equals "/somewhere-else"')
      expect(result.failure?.actual).toContain('"/notes"')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'an unmet text assertion carries what the page actually showed',
    async () => {
      const result = await run(repo, [
        {
          driver: 'web',
          navigate: '/',
          expect: { text: { contains: 'Totally Different Product' } },
          timeoutMs: 1_500,
        },
      ])
      expect(result.outcome).toBe('fail')
      expect(result.failure?.expected).toContain('the page text contains')
      // The page's own words ride the failure the way a cli step's stdout does.
      expect(result.failure?.stdout).toContain('Guard Web Fixture')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'waits for observable state rather than sleeping — the late text arrives and passes',
    async () => {
      // The paragraph says "still working" until the page rewrites it. A step that
      // glanced once would fail; a step that slept would be slow AND fragile.
      const result = await run(repo, [
        {
          driver: 'web',
          navigate: '/slow-text',
          expect: { text: { contains: 'ready at last' } },
          timeoutMs: 10_000,
        },
      ])
      expect(result.outcome).toBe('pass')
      expect(result.durationMs).toBeLessThan(10_000)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'MIXED: a cli step writes what the browser then sees, in ONE sandbox',
    async () => {
      const result = await run(
        repo,
        [
          // The recipe entrypoint, in the sandbox the web surface will serve.
          {
            run: ['note', 'notes.txt', 'shipped by the CLI'],
            expect: { exit: 0, files: { 'notes.txt': { contains: 'shipped by the CLI' } } },
          },
          {
            driver: 'web',
            navigate: '/notes',
            expect: { text: { contains: 'shipped by the CLI' } },
            milestone: 1,
          },
        ],
        'web.mixed.cli.1',
      )
      expect(result.outcome).toBe('pass')
      const text = transcript(repo, 'web.mixed.cli.1')
      // ONE transcript, both surfaces: the cli step with its argv and exit code, the
      // web step with its address and page text.
      expect(text).toContain('"note","notes.txt","shipped by the CLI"')
      expect(text).toContain('exit:    0')
      expect(text).toContain('web:      navigate /notes')
      expect(text).toContain('shipped by the CLI')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'tokens interpolate in web strings exactly as they do in cli strings',
    async () => {
      const result = await run(
        repo,
        [
          { run: ['note', 'notes.txt', 'id ${unique}'], expect: { exit: 0 } },
          { run: ['show', 'notes.txt'], capture: { id: { pattern: 'id (\\S+)' } }, expect: { exit: 0 } },
          // `${captured:…}` in a navigate path, a typed value and a text matcher.
          {
            driver: 'web',
            navigate: '/notes?title=${captured:id}',
            expect: { text: { contains: '${captured:id}' } },
          },
          { driver: 'web', navigate: '/' },
          { driver: 'web', fill: { role: 'textbox', name: 'Title' }, value: '${captured:id}' },
          {
            driver: 'web',
            click: { role: 'button', name: 'Save' },
            expect: { url: { contains: '${captured:id}' } },
          },
        ],
        'web.tokens.cli.1',
      )
      expect(result.outcome).toBe('pass')
      const text = transcript(repo, 'web.tokens.cli.1')
      // The transcript quotes the RESOLVED value, never the token.
      expect(text).not.toContain('${captured:id}')
      expect(text).toMatch(/web: {6}navigate \/notes\?title=\S+/)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'a scenario with web steps and no `web` block in the recipe is a loud error',
    async () => {
      const bare = makeWebRepo({ omitWeb: true })
      try {
        const result = await run(bare, [{ driver: 'web', navigate: '/' }])
        expect(result.outcome).toBe('error')
        expect(result.failure?.actual).toContain('recipe.json declares no `web` block')
      } finally {
        rmrf(bare)
      }
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'a web surface that never becomes ready is infrastructure, with its output attached',
    async () => {
      const broken = makeWebRepo({ healthPath: '/never', readyTimeoutMs: 2_000 })
      try {
        const result = await run(broken, [{ driver: 'web', navigate: '/' }])
        expect(result.outcome).toBe('error')
        expect(result.failure?.actual).toContain('the web surface did not come up')
        expect(result.failure?.actual).toContain('/never')
      } finally {
        rmrf(broken)
      }
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'TEARDOWN: the surface and the browser are gone when the scenario settles',
    async () => {
      const pidFile = path.join(repo, 'web-server.pid')
      const scoped = makeWebRepo({ env: { TC_WEB_PIDFILE: pidFile } })
      try {
        const surface = webSurfaceOf(scoped)!
        const s = scenario({
          id: 'web.teardown.cli.1',
          steps: [{ driver: 'web', navigate: '/', expect: { text: { contains: 'Guard Web Fixture' } } }],
          binds: specBinds('a/b'),
        })
        const before = playwrightBrowserPids()
        const result = await runScenario(s, {
          repoRoot: scoped,
          runId: 'run-web',
          resolvedEntry: ['node', FIXTURE_BIN],
          unique: scenarioUnique(newRunNonce(), s.id),
          stepTimeoutMs: 20_000,
          capturePassEvidence: true,
          web: surface,
        })
        expect(result.outcome).toBe('pass')

        // The SERVER: the fixture recorded its own pid, so this is the OS's answer,
        // not the runner's claim about itself.
        const serverPid = Number(fs.readFileSync(pidFile, 'utf-8'))
        expect(Number.isInteger(serverPid)).toBe(true)
        expect(isAlive(serverPid)).toBe(false)

        // The BROWSER: no chromium the run started is still running.
        const after = playwrightBrowserPids()
        expect(after.filter((pid) => !before.includes(pid))).toEqual([])
      } finally {
        rmrf(scoped)
      }
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'a web session closes its own server and browser processes',
    async () => {
      // The session seam, checked directly: `runScenario` is one caller of it, and
      // an orphan check is worth more the closer it sits to the thing that spawns.
      const pidFile = path.join(repo, 'session-server.pid')
      const scoped = makeWebRepo({ env: { TC_WEB_PIDFILE: pidFile } })
      const dir = path.join(scoped, 'evidence')
      try {
        const before = playwrightBrowserPids()
        const opened = await openWebSession({
          surface: webSurfaceOf(scoped)!,
          repoRoot: scoped,
          sandboxCwd: scoped,
          sandboxEnv: { PATH: process.env.PATH ?? '', TC_WEB_PIDFILE: pidFile },
          evidenceDir: dir,
        })
        expect(opened.ok).toBe(true)
        if (!opened.ok) return
        const during = playwrightBrowserPids().filter((pid) => !before.includes(pid))
        expect(during.length).toBeGreaterThan(0)
        const serverPid = Number(fs.readFileSync(pidFile, 'utf-8'))
        expect(isAlive(serverPid)).toBe(true)

        await opened.session.close()
        expect(isAlive(serverPid)).toBe(false)
        expect(during.filter(isAlive)).toEqual([])
        // Closing twice is a no-op, not a second teardown.
        await opened.session.close()
      } finally {
        rmrf(scoped)
      }
    },
    TEST_TIMEOUT_MS,
  )

  it('leaves no chromium behind across the whole suite', () => {
    expect(playwrightBrowserPids().filter((pid) => !pidsBefore.includes(pid))).toEqual([])
  })
})
