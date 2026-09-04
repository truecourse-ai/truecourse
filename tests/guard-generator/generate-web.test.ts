/**
 * The WEB AUTHORING ARM, end to end in a real browser: `guard generate` matches a
 * web surface, briefs a worker under the web prompt, executes the submitted web
 * steps in a real sandbox (the fixture web app served from the recipe's `web`
 * block), and commits the scenario. In its own file — with the same hard browser
 * gate as the runner's web-driver suite — so the main generate suite stays
 * browser-free.
 *
 * The worker seam is scripted (no LLM); everything it submits goes through the
 * engine's REAL `submit_scenario` closure: pre-flight, sandbox execution,
 * fidelity, the fold. What these cases prove is the plumbing a prompt cannot:
 *  - a web-only scenario is authored, runs GREEN, and is committed with
 *    step-derived `web` drivership;
 *  - a MIXED scenario is one world — a cli step writes what the browser then
 *    reads off the page;
 *  - the web surface's own `build` command runs under generate (worker
 *    executions pass `skipBuild`, so generate must run it itself).
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { isBrowserInstalled } from '@truecourse/guard-runner'
import { guardScenarioDrivers, interfaceFingerprint, type GuardScenario, type Interface } from '@truecourse/shared'
import {
  FIXTURE_WEB_SERVER,
  PASSING_STEPS,
  PASSING_WEB_STEPS,
  cliInterface,
  extractSessionBy,
  interfacesOf,
  makeTempRepo,
  raw,
  rawWeb,
  rmrf,
  runGenerate,
  submitWorkerSessions,
  writeCorpus,
  writeDoc,
  writeRecipe,
} from './helpers.js'

/** A browser boots per execution: generous, but still bounded. */
const TEST_TIMEOUT_MS = 120_000

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

const DOC = 'docs/app.md'
const DOC_CONTENT = ['## home', 'The home page shows the heading "Guard Web Fixture".'].join('\n')

/** A web interface over the fixture app's home screen — the mapper-derived shape. */
function webInterface(): Interface {
  const shape = {
    type: 'web' as const,
    entry: { command: ['/'] },
    steps: [{ kind: 'navigate' as const, route: '/' }],
  }
  return { id: 'web/home', title: 'Home', ...shape, fingerprint: interfaceFingerprint(shape) }
}

function seed(webOverrides: { build?: string } = {}): string {
  const r = repo()
  writeRecipe(r, { web: { serve: ['node', FIXTURE_WEB_SERVER], healthPath: '/health', ...webOverrides } })
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, DOC_CONTENT)
  return r
}

function committed(repoRoot: string, file: string): GuardScenario {
  return yaml.load(fs.readFileSync(path.join(repoRoot, file), 'utf-8')) as GuardScenario
}

describe('generateGuards — the web authoring arm (real browser)', () => {
  beforeAll(async () => {
    // Assert, never skip: a missing browser must fail the suite loudly.
    expect(await isBrowserInstalled()).toBe(true)
  })

  it(
    'authors, executes and commits a web-only scenario — and runs the web build first',
    async () => {
      const r = seed({ build: `node -e "require('fs').writeFileSync('web-built.txt','yes')"` })

      const res = await runGenerate({
        repoRoot: r,
        interfaces: interfacesOf(r, webInterface()),
        extractSession: extractSessionBy({}),
        flowWorkerSession: submitWorkerSessions(() => rawWeb('The home page shows the fixture heading', PASSING_WEB_STEPS)),
      })

      expect(res.errors).toEqual([])
      const web = res.written.find((w) => w.surface === 'web')!
      expect(web).toMatchObject({ surface: 'web', status: 'passing' })
      // Drivership is read off the STEPS of the committed file — no declared driver.
      expect(guardScenarioDrivers(committed(r, web.file))).toEqual(['web'])
      // The surface's own build ran under generate, in the surface's env — the
      // worker executions all pass skipBuild, so nothing else would compile it.
      expect(fs.existsSync(path.join(r, 'web-built.txt'))).toBe(true)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'a mixed scenario is one world — the cli seeds what the browser then reads',
    async () => {
      const r = seed()

      const res = await runGenerate({
        repoRoot: r,
        interfaces: interfacesOf(r, cliInterface(['relkit']), webInterface()),
        extractSession: extractSessionBy({}),
        flowWorkerSession: submitWorkerSessions((task) =>
          task.surface === 'web'
            ? rawWeb('Notes written by the CLI appear on the notes page', [
                { run: ['note', 'notes.txt', 'shipped by the CLI'], expect: { exit: 0 } },
                {
                  driver: 'web',
                  navigate: '/notes',
                  expect: { text: { contains: 'shipped by the CLI' } },
                },
              ])
            : raw('relkit --version prints the version', PASSING_STEPS),
        ),
      })

      expect(res.errors).toEqual([])
      const web = res.written.find((w) => w.surface === 'web')!
      expect(web.status).toBe('passing')
      expect(guardScenarioDrivers(committed(r, web.file))).toEqual(['cli', 'web'])
    },
    TEST_TIMEOUT_MS,
  )
})
