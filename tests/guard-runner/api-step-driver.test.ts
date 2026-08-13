/**
 * REQUEST STEPS IN THE SANDBOX — the api driver's verb taken in the ONE-WORLD
 * sandbox, against the surface the recipe's `web` block serves.
 *
 * The principle under test (owner, 2026-08-11): drive the UI to act, then read the
 * result as STRUCTURED DATA through the API instead of regexing the page for it. So
 * what each block is really asserting:
 *  - a request step reaches the SAME origin the browser drives — one world, one server;
 *  - a request-only scenario still lazy-starts that server, with no browser at all;
 *  - values flow both ways: a cli capture reaches a request path, a request capture
 *    reaches a web `fill` and a later cli argv;
 *  - the transcript speaks api — method, path, status, body, and EVERY assertion
 *    beside its OWN answer (the honest pairing the web records already keep);
 *  - a json assertion that misses is a `fail` with the body attached, and a capture
 *    that resolves to nothing is that step failing, never an empty value flowing on;
 *  - nothing outlives the scenario — the server is gone whether or not a browser ran.
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
  resolveWebSurface,
  runScenario,
  scenarioUnique,
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

/** The fixture web app: two pages AND a JSON surface over the same `notes.txt`. */
const FIXTURE_WEB_SERVER = fileURLToPath(
  new URL('../fixtures/guard-fixture-web/server.mjs', import.meta.url),
)

const TEST_TIMEOUT_MS = 60_000

/** A repo whose recipe runs `relkit` and serves the fixture web app. */
function makeWebRepo(env?: Record<string, string>): string {
  const repo = makeTempRepo()
  const recipe = {
    build: 'true',
    entry: ['node', FIXTURE_BIN],
    web: {
      serve: ['node', FIXTURE_WEB_SERVER],
      healthPath: '/health',
      readyTimeoutMs: 20_000,
      ...(env ? { env } : {}),
    },
  }
  const target = path.join(repo, '.truecourse', 'scenarios', 'recipe.json')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(recipe, null, 2))
  writeSpecDoc(repo)
  return repo
}

function webSurfaceOf(repo: string): ResolvedWebSurface | null {
  const loaded = loadRecipe(repo, path.join(repo, '.truecourse', 'scenarios', 'recipe.json'))
  if (!loaded) throw new Error('the fixture recipe did not load')
  return resolveWebSurface(loaded.recipe)
}

async function run(repo: string, steps: GuardSandboxStep[], id: string) {
  const s: GuardSandboxScenario = scenario({ id, steps, binds: specBinds('a/b') })
  const surface = webSurfaceOf(repo)
  return await runScenario(s, {
    repoRoot: repo,
    runId: 'run-api-step',
    resolvedEntry: ['node', FIXTURE_BIN],
    unique: scenarioUnique(newRunNonce(), s.id),
    stepTimeoutMs: 20_000,
    capturePassEvidence: true,
    ...(surface ? { web: surface } : {}),
  })
}

function evidenceDir(repo: string, id: string): string {
  return path.join(repo, '.truecourse', 'guard', 'evidence', 'run-api-step', id)
}

function transcript(repo: string, id: string): string {
  return fs.readFileSync(path.join(evidenceDir(repo, id), 'transcript.txt'), 'utf-8')
}

function invocation(repo: string, id: string): {
  steps: {
    index: number
    kind?: string
    status?: number | null
    body?: string
    api?: { command: string; checks?: { subject: string; expected: string; actual: string; ok: boolean }[] }
  }[]
} {
  return JSON.parse(fs.readFileSync(path.join(evidenceDir(repo, id), 'invocation.json'), 'utf-8'))
}

describe('a request step in the sandbox', () => {
  let repo: string
  let pidsBefore: number[]

  beforeAll(() => {
    pidsBefore = playwrightBrowserPids()
    repo = makeWebRepo()
  })

  afterAll(() => {
    rmrf(repo)
  })

  it(
    'reads the sandbox’s served surface as JSON — with NO browser anywhere',
    async () => {
      // A scenario with request steps and no web steps still lazy-starts the same
      // server, the same way a web step does; a browser would be a cost with nothing
      // to show for it.
      const before = playwrightBrowserPids()
      const result = await run(
        repo,
        [
          { run: ['note', 'notes.txt', 'shipped by the CLI'], expect: { exit: 0 } },
          {
            request: { method: 'GET', path: '/api/notes' },
            expect: {
              status: 200,
              json: { total: { equals: 1 }, 'notes[0]': { contains: 'shipped by the CLI' } },
            },
          },
        ],
        'api.readonly.cli.1',
      )
      expect(result.outcome).toBe('pass')
      expect(playwrightBrowserPids().filter((pid) => !before.includes(pid))).toEqual([])
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'MIXED: the browser ACTS, the request reads the structured answer — one origin',
    async () => {
      expect(
        await isBrowserInstalled(),
        'playwright-core + chromium must be installed for the mixed request/web suite',
      ).toBe(true)
      const result = await run(
        repo,
        [
          { run: ['note', 'notes.txt', 'first note'], expect: { exit: 0 } },
          // The UI action: type a title and save, which the fixture turns into a
          // navigation the page then renders.
          { driver: 'web', navigate: '/' },
          { driver: 'web', fill: { role: 'textbox', name: 'Title' }, value: 'release notes' },
          {
            driver: 'web',
            click: { role: 'button', name: 'Save' },
            expect: { url: { contains: '/notes?title=release' }, text: { contains: 'first note' } },
            milestone: 1,
          },
          // …and the structured read of the SAME state, from the SAME origin.
          {
            request: { method: 'GET', path: '/api/notes?q=first' },
            expect: {
              status: 200,
              json: { total: { equals: 1 }, filter: { equals: 'first' }, 'notes[0]': { equals: 'first note' } },
            },
            milestone: 1,
          },
        ],
        'api.mixed.cli.1',
      )
      expect(result.outcome).toBe('pass')
      const text = transcript(repo, 'api.mixed.cli.1')
      // ONE transcript, three surfaces.
      expect(text).toContain('exit:    0')
      expect(text).toContain('web:      fill textbox “Title” with “release notes”')
      expect(text).toContain('api:      GET /api/notes?q=first')
      expect(text).toContain('status:   200')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'records EVERY assertion beside the response’s own answer to THAT assertion',
    async () => {
      const result = await run(
        repo,
        [
          { run: ['note', 'notes.txt', 'pairing'], expect: { exit: 0 } },
          {
            request: { method: 'GET', path: '/api/notes' },
            expect: {
              status: 200,
              headers: { 'content-type': { contains: 'application/json' } },
              json: { total: { equals: 1 }, 'notes[0]': { equals: 'pairing' } },
            },
          },
        ],
        'api.pairing.cli.1',
      )
      expect(result.outcome).toBe('pass')
      const text = transcript(repo, 'api.pairing.cli.1')
      expect(text).toContain('✓ expected: status 200')
      expect(text).toContain('   actual:   status 200')
      expect(text).toContain('✓ expected: header content-type contains "application/json"')
      expect(text).toMatch(/actual: {3}header content-type was "application\/json/)
      expect(text).toContain('✓ expected: json total is 1')
      expect(text).toContain('   actual:   json total was 1')
      expect(text).toContain('✓ expected: json notes[0] is "pairing"')
      // The same pairs ride in the bundle the dashboard reads back.
      const step = invocation(repo, 'api.pairing.cli.1').steps.find((s) => s.index === 2)
      expect(step?.kind).toBe('api')
      expect(step?.status).toBe(200)
      expect(step?.api?.command).toBe('GET /api/notes')
      expect(step?.api?.checks?.map((c) => c.subject)).toEqual(['status', 'headers', 'json', 'json'])
      expect(step?.api?.checks?.every((c) => c.ok)).toBe(true)
      expect(step?.body).toContain('"pairing"')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'a json assertion that misses is a FAIL, with the body as evidence',
    async () => {
      const result = await run(
        repo,
        [
          { run: ['note', 'notes.txt', 'only one'], expect: { exit: 0 } },
          {
            request: { method: 'GET', path: '/api/notes' },
            expect: { status: 200, json: { total: { equals: 7 } } },
          },
        ],
        'api.miss.cli.1',
      )
      expect(result.outcome).toBe('fail')
      expect(result.failure?.step).toBe(2)
      expect(result.failure?.expected).toContain('json total equals 7')
      expect(result.failure?.actual).toContain('json total was')
      // The response body rides the failure the way a cli step's stdout does.
      expect(result.failure?.stdout).toContain('only one')
      const text = transcript(repo, 'api.miss.cli.1')
      expect(text).toContain('✗ expected: json total is 7')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'CAPTURES flow out of a request into a web fill and into a cli argv',
    async () => {
      const result = await run(
        repo,
        [
          // The request ACTS: it creates a note and hands forward what the server minted.
          {
            request: { method: 'POST', path: '/api/notes', json: { line: 'made by ${unique}' } },
            expect: { status: 201, json: { id: { equals: 0 } } },
            capture: { id: 'id', line: 'line' },
          },
          // …into a browser step's typed value…
          { driver: 'web', navigate: '/' },
          { driver: 'web', fill: { role: 'textbox', name: 'Title' }, value: '${captured:line}' },
          {
            driver: 'web',
            click: { role: 'button', name: 'Save' },
            expect: { text: { contains: '${captured:line}' } },
          },
          // …and into a cli argv, which writes the value back into the sandbox.
          { run: ['note', 'echo.txt', 'note ${captured:id} says ${captured:line}'], expect: { exit: 0 } },
          {
            request: { method: 'GET', path: '/api/notes/${captured:id}' },
            expect: { status: 200, json: { line: { equals: '${captured:line}' } } },
          },
        ],
        'api.captures.cli.1',
      )
      expect(result.outcome).toBe('pass')
      const text = transcript(repo, 'api.captures.cli.1')
      // The transcript quotes RESOLVED values, never the tokens.
      expect(text).not.toContain('${captured:')
      expect(text).toContain('capture:')
      expect(text).toMatch(/api: {6}GET \/api\/notes\/0/)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'a capture whose path resolves to nothing is THAT step failing',
    async () => {
      const result = await run(
        repo,
        [
          {
            request: { method: 'GET', path: '/api/notes' },
            expect: { status: 200 },
            capture: { nope: 'notAField' },
          },
        ],
        'api.capture-miss.cli.1',
      )
      expect(result.outcome).toBe('fail')
      expect(result.failure?.expected).toContain('capture "nope" at json path "notAField"')
      expect(result.failure?.actual).toContain('the path resolved to nothing')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'a scenario with request steps and no `web` block in the recipe is a loud error',
    async () => {
      const bare = makeTempRepo()
      writeSpecDoc(bare)
      const target = path.join(bare, '.truecourse', 'scenarios', 'recipe.json')
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, JSON.stringify({ build: 'true', entry: ['node', FIXTURE_BIN] }))
      try {
        const result = await run(
          bare,
          [{ request: { method: 'GET', path: '/api/notes' }, expect: { status: 200 } }],
          'api.no-surface.cli.1',
        )
        expect(result.outcome).toBe('error')
        expect(result.failure?.actual).toContain('`request` steps')
        expect(result.failure?.actual).toContain('recipe.json declares no `web` block')
      } finally {
        rmrf(bare)
      }
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'TEARDOWN: the surface a request-only scenario started is gone when it settles',
    async () => {
      const pidFile = path.join(repo, 'api-only-server.pid')
      const scoped = makeWebRepo({ TC_WEB_PIDFILE: pidFile })
      try {
        const result = await run(
          scoped,
          [{ request: { method: 'GET', path: '/api/notes' }, expect: { status: 200 } }],
          'api.teardown.cli.1',
        )
        expect(result.outcome).toBe('pass')
        // The fixture recorded its own pid, so this is the OS's answer, not the
        // runner's claim about itself.
        const serverPid = Number(fs.readFileSync(pidFile, 'utf-8'))
        expect(Number.isInteger(serverPid)).toBe(true)
        expect(isAlive(serverPid)).toBe(false)
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
