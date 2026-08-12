/**
 * THE VISUAL JUDGE'S WIRING, in a real browser against `guard-fixture-web`.
 *
 * The property under test is not "the model is right" — the runner never sees a
 * model. It is that the judge is a strictly OPTIONAL ANNOTATOR bolted to the one
 * moment it belongs at:
 *   - it fires ONCE, only when a web step has already FAILED and left a screenshot;
 *   - a green scenario never pays for it;
 *   - what it returns lands in the evidence a human reads, and in the compact
 *     `failure.visual` the board carries;
 *   - it can NEVER move a verdict — a `yes` verdict on a failing step leaves the
 *     step failing, and a judge that throws leaves the run exactly as it was;
 *   - with no judge injected the runner behaves byte-for-byte as it did before.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import type { GuardCliScenario, GuardSandboxStep, GuardVisualJudgment } from '@truecourse/shared'
import {
  isBrowserInstalled,
  loadRecipe,
  newRunNonce,
  resolveWebSurface,
  runScenario,
  scenarioUnique,
  type GuardVisualJudgeInput,
  type ResolvedWebSurface,
} from '@truecourse/guard-runner'
import { FIXTURE_BIN, makeTempRepo, rmrf, scenario, specBinds, writeSpecDoc } from './helpers.js'

const FIXTURE_WEB_SERVER = fileURLToPath(
  new URL('../fixtures/guard-fixture-web/server.mjs', import.meta.url),
)

const TEST_TIMEOUT_MS = 60_000

function makeWebRepo(): string {
  const repo = makeTempRepo()
  const recipe = {
    build: 'true',
    entry: ['node', FIXTURE_BIN],
    web: { serve: ['node', FIXTURE_WEB_SERVER], healthPath: '/health', readyTimeoutMs: 20_000 },
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

/** A judge that records what it was asked and answers with `verdict`. */
function recordingJudge(verdict: GuardVisualJudgment) {
  const seen: GuardVisualJudgeInput[] = []
  return {
    seen,
    judge: async (input: GuardVisualJudgeInput) => {
      seen.push(input)
      return verdict
    },
  }
}

const NOT_VISIBLE: GuardVisualJudgment = {
  expectedVisible: 'no',
  screenSummary: 'The fixture home page with a Reveal button; no “totally absent words” anywhere.',
  rationale: 'The asserted phrase is nowhere in the rendered page.',
}

interface RunOpts {
  id?: string
  visualJudge?: (input: GuardVisualJudgeInput) => Promise<GuardVisualJudgment | null>
}

async function run(repo: string, steps: GuardSandboxStep[], opts: RunOpts = {}) {
  const id = opts.id ?? 'web.judge.cli.1'
  const s: GuardCliScenario = scenario({ id, steps, binds: specBinds('a/b') })
  const surface = webSurfaceOf(repo)
  return await runScenario(s, {
    repoRoot: repo,
    runId: 'run-judge',
    resolvedEntry: ['node', FIXTURE_BIN],
    unique: scenarioUnique(newRunNonce(), s.id),
    stepTimeoutMs: 15_000,
    capturePassEvidence: true,
    ...(surface ? { web: surface } : {}),
    ...(opts.visualJudge ? { visualJudge: opts.visualJudge } : {}),
  })
}

function evidenceDir(repo: string, id: string): string {
  return path.join(repo, '.truecourse', 'guard', 'evidence', 'run-judge', id)
}

function evidenceFile(repo: string, id: string, name: string): string {
  return fs.readFileSync(path.join(evidenceDir(repo, id), name), 'utf-8')
}

/**
 * A step whose expectation the fixture page cannot possibly satisfy. Its own short
 * `timeoutMs` keeps the suite honest AND quick: the wait is what proves nothing was
 * shown, and two seconds of a page that renders instantly proves it as well as ten.
 */
const IMPOSSIBLE: GuardSandboxStep[] = [
  { driver: 'web', navigate: '/' },
  {
    driver: 'web',
    expect: { text: { contains: 'totally absent words' } },
    timeoutMs: 2_000,
    note: 'the home page greets the reader by name',
    milestone: 1,
  },
]

describe('the visual judge annotates failing web steps', () => {
  let repo: string

  beforeAll(async () => {
    expect(
      await isBrowserInstalled(),
      'playwright-core + chromium must be installed for the visual-judge suite',
    ).toBe(true)
    repo = makeWebRepo()
  })

  afterAll(() => rmrf(repo))

  it(
    'a failing web step is judged once, and the verdict reaches every surface a reader uses',
    async () => {
      const { seen, judge } = recordingJudge(NOT_VISIBLE)
      const result = await run(repo, IMPOSSIBLE, { id: 'web.judge.cli.1', visualJudge: judge })

      expect(result.outcome).toBe('fail')
      expect(seen).toHaveLength(1)
      const asked = seen[0]
      // The human-level claim AND the mechanical expectation — the judge needs both:
      // one says what the step is FOR, the other says exactly what was measured.
      expect(asked.claim).toBe('the home page greets the reader by name')
      expect(asked.expectation).toContain('totally absent words')
      expect(asked.expected).toBe(result.failure?.expected)
      expect(asked.actual).toBe(result.failure?.actual)
      expect(asked.stepIndex).toBe(2)
      expect(asked.scenarioId).toBe('web.judge.cli.1')
      // A real, readable PNG the step just took.
      expect(fs.existsSync(asked.screenshotPath)).toBe(true)
      expect(path.basename(asked.screenshotPath)).toBe('step-2.png')
      expect(fs.readFileSync(asked.screenshotPath).subarray(1, 4).toString()).toBe('PNG')

      // The compact annotation the committable board carries…
      expect(result.failure?.visual).toEqual({ verdict: 'no', summary: NOT_VISIBLE.screenSummary })
      // …the diff, where the full rationale lives…
      const diff = evidenceFile(repo, 'web.judge.cli.1', 'diff.txt')
      expect(diff).toContain('visual-judge:')
      expect(diff).toContain('NOT visible')
      expect(diff).toContain(NOT_VISIBLE.rationale)
      // …and the transcript, which is the file a human opens first.
      const text = evidenceFile(repo, 'web.judge.cli.1', 'transcript.txt')
      expect(text).toContain('outcome:  fail')
      expect(text).toContain(NOT_VISIBLE.screenSummary)
      // It never claims to have decided anything.
      expect(text).toContain('ANNOTATION')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'a `yes` verdict says the assertion may be wrong — and the step still FAILS',
    async () => {
      const judge = async (): Promise<GuardVisualJudgment> => ({
        expectedVisible: 'yes',
        screenSummary: 'The phrase is plainly rendered in the page header.',
        rationale: 'The locator is probably matching the wrong node.',
      })
      const result = await run(repo, IMPOSSIBLE, { id: 'web.judge.cli.3', visualJudge: judge })

      // THE RULE: the deterministic check is authoritative. An opinion never rescues.
      expect(result.outcome).toBe('fail')
      expect(result.failure?.visual?.verdict).toBe('yes')
      const diff = evidenceFile(repo, 'web.judge.cli.3', 'diff.txt')
      expect(diff).toContain('the assertion itself may be wrong')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'a judge that throws — or declines — changes nothing at all',
    async () => {
      const result = await run(repo, IMPOSSIBLE, {
        id: 'web.judge.cli.4',
        visualJudge: async () => {
          throw new Error('no transport installed')
        },
      })
      expect(result.outcome).toBe('fail')
      expect(result.failure?.visual).toBeUndefined()
      expect(evidenceFile(repo, 'web.judge.cli.4', 'diff.txt')).not.toContain('visual-judge')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'no judge injected — the run is exactly what it always was',
    async () => {
      const result = await run(repo, IMPOSSIBLE, { id: 'web.judge.cli.6' })
      expect(result.outcome).toBe('fail')
      expect(result.failure?.visual).toBeUndefined()
      expect(evidenceFile(repo, 'web.judge.cli.6', 'diff.txt')).not.toContain('visual-judge')
      expect(evidenceFile(repo, 'web.judge.cli.6', 'transcript.txt')).not.toContain('visual-judge')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'a green scenario never calls the judge — a passing run costs zero',
    async () => {
      const { seen, judge } = recordingJudge(NOT_VISIBLE)
      const result = await run(
        repo,
        [
          { driver: 'web', navigate: '/', expect: { text: { contains: 'Guard Web Fixture' } } },
          { driver: 'web', expect: { url: { equals: '/' } }, milestone: 1 },
        ],
        { id: 'web.judge.cli.7', visualJudge: judge },
      )
      expect(result.outcome).toBe('pass')
      expect(seen).toHaveLength(0)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'a failing CLI step is never judged — there is no screen to look at',
    async () => {
      const { seen, judge } = recordingJudge(NOT_VISIBLE)
      const result = await run(
        repo,
        [{ run: ['nope'], expect: { exit: 0 } }],
        { id: 'web.judge.cli.8', visualJudge: judge },
      )
      expect(result.outcome).not.toBe('pass')
      expect(seen).toHaveLength(0)
    },
    TEST_TIMEOUT_MS,
  )
})
