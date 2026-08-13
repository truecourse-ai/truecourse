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
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import type { GuardSandboxScenario, GuardSandboxStep } from '@truecourse/shared'
import {
  isBrowserInstalled,
  loadRecipe,
  newRunNonce,
  openWebSession,
  resolveWebSurface,
  runScenario,
  sandboxSurface,
  scenarioUnique,
  WEB_VIDEO_FILE,
  type ResolvedWebSurface,
} from '@truecourse/guard-runner'
import {
  FIXTURE_BIN,
  isAlive,
  makeTempRepo,
  playwrightBrowserPids,
  rmrf,
  scenario,
  specBinds,
  writeSpecDoc,
} from './helpers.js'

/** Absolute path to the fixture WEB app (two linked pages, a button, a text change). */
const FIXTURE_WEB_SERVER = fileURLToPath(
  new URL('../fixtures/guard-fixture-web/server.mjs', import.meta.url),
)

/** A browser step is a real browser: generous, but still bounded. */
const TEST_TIMEOUT_MS = 60_000

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
  const s: GuardSandboxScenario = scenario({ id, steps, binds: specBinds('a/b') })
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
    'evaluates EVERY member of a web expectation — a text miss fails a step whose address matches',
    async () => {
      // The address holds and the page text does not. A step that stopped at the
      // first member that passed would report green on a page that never showed
      // what the claim promises.
      const result = await run(repo, [
        {
          driver: 'web',
          navigate: '/notes',
          expect: { url: { equals: '/notes' }, text: { contains: 'Totally Different Product' } },
          timeoutMs: 1_500,
        },
      ])
      expect(result.outcome).toBe('fail')
      expect(result.failure?.expected).toContain('the page text contains')
      expect(result.failure?.actual).toContain('no notes yet')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'evaluates the presence member too — an address and a text that hold do not carry a missing control',
    async () => {
      const result = await run(repo, [
        {
          driver: 'web',
          navigate: '/notes',
          expect: {
            url: { equals: '/notes' },
            text: { contains: 'no notes yet' },
            visible: { role: 'button', name: 'Publish' },
          },
          timeoutMs: 1_500,
        },
      ])
      expect(result.outcome).toBe('fail')
      expect(result.failure?.expected).toContain('button “Publish”')
      expect(result.failure?.actual).toContain('no button named “Publish” is on the page')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'a PASSING web step records each expectation beside the page’s own answer to THAT expectation',
    async () => {
      const result = await run(
        repo,
        [
          {
            driver: 'web',
            navigate: '/notes',
            expect: {
              url: { equals: '/notes' },
              text: { contains: 'no notes yet' },
              visible: { role: 'link', name: 'Home' },
            },
          },
        ],
        'web.pairing.cli.1',
      )
      expect(result.outcome).toBe('pass')
      const text = transcript(repo, 'web.pairing.cli.1')
      // Every member is paired with what the page actually had FOR IT: the address
      // answers the address assertion, the page's words answer the text assertion,
      // and the control answers the presence assertion. A single `at: /notes` line
      // standing in as the "actual" of a text assertion is the mispairing this
      // guards against.
      expect(text).toContain('✓ expected: the address equals "/notes"')
      expect(text).toContain('   actual:   the address was "/notes"')
      expect(text).toContain('✓ expected: the page text contains "no notes yet"')
      expect(text).toMatch(/actual: {3}the page text was "[^"]*no notes yet/)
      expect(text).toContain('✓ expected: link “Home” is visible')
      expect(text).toContain('   actual:   link “Home” is visible')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'the page text a step RECORDS is the page text its expectation was evaluated against',
    async () => {
      // A record trimmed shorter than the asserted window cannot be checked by the
      // reader: the transcript would show a page missing the very words the step
      // asserted, next to a green tick. The marker sits past the stream excerpt cap
      // (1,200) and inside the asserted window (2,000).
      const long = 'x'.repeat(1_500) + ' TAIL-MARKER'
      const result = await run(
        repo,
        [
          { run: ['note', 'notes.txt', long], expect: { exit: 0 } },
          {
            driver: 'web',
            navigate: '/notes',
            expect: { text: { contains: 'TAIL-MARKER' } },
          },
        ],
        'web.record-window.cli.1',
      )
      expect(result.outcome).toBe('pass')
      // Read the WEB step's own record — the cli step's argv quotes the marker too.
      const bundle = JSON.parse(
        fs.readFileSync(path.join(evidenceDir(repo, 'web.record-window.cli.1'), 'invocation.json'), 'utf-8'),
      ) as { steps: { index: number; web?: { visibleText: string } }[] }
      const web = bundle.steps.find((s) => s.index === 2)?.web
      expect(web?.visibleText).toContain('TAIL-MARKER')
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
    'the browser session and the SHARED surface each close what they own',
    async () => {
      // The two seams, checked directly: `runScenario` is one caller of them, and an
      // orphan check is worth more the closer it sits to the thing that spawns. The
      // ownership split is the point — the session closes the BROWSER and leaves the
      // server standing (a request step may still be using it); the sandbox's surface
      // closes the SERVER, after everyone has let go.
      const pidFile = path.join(repo, 'session-server.pid')
      const scoped = makeWebRepo({ env: { TC_WEB_PIDFILE: pidFile } })
      const dir = path.join(scoped, 'evidence')
      const served = sandboxSurface(webSurfaceOf(scoped))
      try {
        const before = playwrightBrowserPids()
        const surface = await served.open({
          repoRoot: scoped,
          sandbox: {
            cwd: scoped,
            env: { PATH: process.env.PATH ?? '', TC_WEB_PIDFILE: pidFile },
          },
        } as never)
        expect(surface.ok).toBe(true)
        if (!surface.ok) return
        const serverPid = Number(fs.readFileSync(pidFile, 'utf-8'))
        expect(isAlive(serverPid)).toBe(true)

        const opened = await openWebSession({ server: surface.server, evidenceDir: dir })
        expect(opened.ok).toBe(true)
        if (!opened.ok) return
        const during = playwrightBrowserPids().filter((pid) => !before.includes(pid))
        expect(during.length).toBeGreaterThan(0)

        await opened.session.close()
        expect(during.filter(isAlive)).toEqual([])
        // The session owns the browser only: the surface is still serving.
        expect(isAlive(serverPid)).toBe(true)
        // Closing twice is a no-op, not a second teardown.
        await opened.session.close()

        await served.close()
        expect(isAlive(serverPid)).toBe(false)
        // The surface, too, is idempotent.
        await served.close()
      } finally {
        await served.close().catch(() => undefined)
        rmrf(scoped)
      }
    },
    TEST_TIMEOUT_MS,
  )

  // --- The observation channels a page's INVISIBLE state needs ----------
  //
  // Everything below is state no `text` matcher can reach: an ARIA state, a class
  // on the document element, an accessible name that is an `aria-label`, and a
  // history entry. The fixture's `/controls` page carries one of each.

  it(
    'asserts an ARIA state on a role + name target, and sees it MOVE',
    async () => {
      const result = await run(
        repo,
        [
          {
            driver: 'web',
            navigate: '/controls',
            expect: { state: { role: 'tab', name: 'Home', selected: true } },
          },
          // The switch is off, and its position lives in `aria-checked` alone.
          { driver: 'web', expect: { state: { role: 'switch', name: 'LLM rules', checked: false } } },
          { driver: 'web', click: { role: 'switch', name: 'LLM rules' } },
          { driver: 'web', expect: { state: { role: 'switch', name: 'LLM rules', checked: true } } },
          // The active tab moves to the one that was clicked.
          { driver: 'web', click: { role: 'tab', name: 'Flows' } },
          { driver: 'web', expect: { state: { role: 'tab', name: 'Flows', selected: true } } },
          { driver: 'web', expect: { state: { role: 'tab', name: 'Home', selected: false } } },
          // A natively disabled control, and a collapsed disclosure.
          { driver: 'web', expect: { state: { role: 'button', name: 'Publish', disabled: true } } },
          { driver: 'web', expect: { state: { role: 'button', name: 'Filters', expanded: false } } },
          { driver: 'web', click: { role: 'button', name: 'Filters' } },
          { driver: 'web', expect: { state: { role: 'button', name: 'Filters', expanded: true } } },
        ],
        'web.state.cli.1',
      )
      expect(result.outcome).toBe('pass')
      const text = transcript(repo, 'web.state.cli.1')
      expect(text).toContain('✓ expected: switch “LLM rules” is checked')
      expect(text).toContain('   actual:   switch “LLM rules” is checked')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'a control whose position is marked by COLOUR alone fails honestly — it exposes no state',
    async () => {
      // The three-way detection switch of the real dashboard, in miniature: the
      // selected position is a class and a colour, and no ARIA state at all. The
      // step must say THAT, not invent a verdict.
      const result = await run(
        repo,
        [
          { driver: 'web', navigate: '/controls' },
          {
            driver: 'web',
            expect: { state: { role: 'button', name: 'Detection mode', pressed: true } },
            timeoutMs: 1_500,
          },
        ],
        'web.state-missing.cli.1',
      )
      expect(result.outcome).toBe('fail')
      expect(result.failure?.expected).toContain('button “Detection mode” is pressed')
      expect(result.failure?.actual).toContain('exposes no aria-pressed')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'sees a CLASS on the document element and an attribute beside it — dark mode lives nowhere else',
    async () => {
      const result = await run(
        repo,
        [
          {
            driver: 'web',
            navigate: '/controls',
            expect: { class: { absent: 'dark' } },
          },
          { driver: 'web', click: { role: 'button', name: 'Toggle theme' } },
          {
            driver: 'web',
            expect: {
              class: { has: 'dark' },
              attribute: { name: 'data-theme', value: { equals: 'dark' } },
            },
          },
          // And an attribute of ONE element, addressed the way every other web
          // step addresses one.
          {
            driver: 'web',
            expect: {
              attribute: {
                of: { role: 'button', name: 'Filters' },
                name: 'aria-expanded',
                value: { equals: 'false' },
              },
            },
          },
        ],
        'web.theme.cli.1',
      )
      expect(result.outcome).toBe('pass')
      const text = transcript(repo, 'web.theme.cli.1')
      expect(text).toContain('✓ expected: the document element has class “dark”')
      expect(text).toContain('✓ expected: the document element’s data-theme is “dark”')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'a class assertion is a TOKEN, not a substring — and a miss quotes the classes that ARE there',
    async () => {
      const result = await run(
        repo,
        [
          { driver: 'web', navigate: '/controls' },
          {
            driver: 'web',
            expect: { class: { of: { role: 'button', name: 'Detection mode' }, has: 'mode' } },
            timeoutMs: 1_500,
          },
        ],
        'web.class-token.cli.1',
      )
      // `mode-committed` is on the element; the token `mode` is not.
      expect(result.outcome).toBe('fail')
      expect(result.failure?.actual).toContain('mode-committed')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'asserts SEVERAL elements visible in one expectation — icon buttons whose names are never in the text',
    async () => {
      const result = await run(
        repo,
        [
          {
            driver: 'web',
            navigate: '/controls',
            expect: {
              visible: [
                { role: 'button', name: 'Fit view' },
                { role: 'button', name: 'Zoom in' },
                { role: 'button', name: 'Zoom out' },
              ],
            },
          },
        ],
        'web.visible-many.cli.1',
      )
      expect(result.outcome).toBe('pass')
      const text = transcript(repo, 'web.visible-many.cli.1')
      // Three assertions, three answers — the pairing rule holds for a list too.
      expect(text).toContain('✓ expected: button “Fit view” is visible')
      expect(text).toContain('✓ expected: button “Zoom in” is visible')
      expect(text).toContain('✓ expected: button “Zoom out” is visible')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'and names the ONE of several targets that was missing',
    async () => {
      const result = await run(
        repo,
        [
          {
            driver: 'web',
            navigate: '/controls',
            expect: {
              visible: [
                { role: 'button', name: 'Fit view' },
                { role: 'button', name: 'Zoom sideways' },
              ],
            },
            timeoutMs: 1_500,
          },
        ],
        'web.visible-miss.cli.1',
      )
      expect(result.outcome).toBe('fail')
      expect(result.failure?.expected).toContain('button “Zoom sideways”')
      expect(result.failure?.actual).toContain('no button named “Zoom sideways” is on the page')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'moves through the history — Back and Forward, as a user presses them',
    async () => {
      const result = await run(
        repo,
        [
          { driver: 'web', navigate: '/' },
          { driver: 'web', click: { role: 'link', name: 'Notes' }, expect: { url: { equals: '/notes' } } },
          { driver: 'web', history: 'back', expect: { url: { equals: '/' }, text: { contains: 'Guard Web Fixture' } } },
          { driver: 'web', history: 'forward', expect: { url: { equals: '/notes' } } },
        ],
        'web.history.cli.1',
      )
      expect(result.outcome).toBe('pass')
      const text = transcript(repo, 'web.history.cli.1')
      expect(text).toContain('web:      go back')
      expect(text).toContain('web:      go forward')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'moves through the history of a SINGLE-PAGE app, where Back loads no document at all',
    async () => {
      const result = await run(
        repo,
        [
          { driver: 'web', navigate: '/controls', expect: { text: { contains: 'filter: off' } } },
          {
            driver: 'web',
            click: { role: 'button', name: 'Add filter' },
            expect: { url: { equals: '/controls?filter=on' }, text: { contains: 'filter: on' } },
          },
          {
            driver: 'web',
            history: 'back',
            expect: { url: { equals: '/controls' }, text: { contains: 'filter: off' } },
          },
        ],
        'web.history-spa.cli.1',
      )
      expect(result.outcome).toBe('pass')
    },
    TEST_TIMEOUT_MS,
  )

  it('leaves no chromium behind across the whole suite', () => {
    expect(playwrightBrowserPids().filter((pid) => !pidsBefore.includes(pid))).toEqual([])
  })
})
