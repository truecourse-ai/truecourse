/**
 * The flow-test session's gate: what the engine accepts as a flow's test and
 * seed. Real specs and seeds in a work tree, run by real Playwright against a
 * page served from this process, held against the outcome a session reports.
 * The fidelity judge is a child session; here it answers what each case says
 * it answers.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import type { FlowTestWorld } from '@truecourse/guard-runner'
import type { FlowTestCopyDrift, FlowTestOutcome, FlowTestRecord, GuardFlow } from '@truecourse/shared'
import { flowSeedPath, flowTestPath, flowTestsDir, worldDir, worldStatePath } from '@truecourse/shared/work-tree'
import {
  flowTestBriefing,
  flowTestSessionDef,
  type FlowTestPrior,
  type FlowTestSessionInput,
} from '../../packages/core/dist/services/product-world/flow-test-session.js'
import { flowTestJudgeKey } from '../../packages/core/dist/services/product-world/flow-test-fidelity.js'
import type { FlowTestStep } from '../../packages/core/dist/services/product-world/flow-test-steps.js'

const FLOW = { id: 'see-invoices', title: 'See invoices', goal: 'A person sees their invoices.' } as GuardFlow
const STEPS: FlowTestStep[] = [
  { order: 1, claimTitle: 'The invoices page lists invoices', claim: 'Opening Invoices shows the list.', doc: 'docs/billing.md', anchor: 'invoices', sectionText: 'The Invoices page lists every invoice.' },
  { order: 2, claimTitle: "The page offers an 'Export' button", doc: 'docs/billing.md', anchor: 'export' },
]
const PASSING: FlowTestOutcome = { status: 'passing', summary: 'The invoices page lists invoices.' }
const FAILING: FlowTestOutcome = {
  status: 'failing',
  summary: 'The invoices page has no export.',
  disagreement: { documented: 'billing.md: the page offers an export', observed: 'no export control' },
}
const BLOCKED: FlowTestOutcome = { status: 'blocked', summary: 'Needs a payment provider.', blockedBy: 'no Stripe account', blockedOn: 'Stripe account' }

const SPEC_HEAD = `import { expect, flowTest } from './flow'
import { seed } from './see-invoices.seed'

const test = flowTest(seed)
`
/** A spec with the flow's two steps; the second asserts the heading, or a button the page lacks. */
const specOf = (second: 'heading' | 'export', titles: [string, string] = [STEPS[0].claimTitle, STEPS[1].claimTitle]): string => `${SPEC_HEAD}
test('a person sees their invoices', async ({ page }) => {
  await test.step(${JSON.stringify(titles[0])}, async () => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible({ timeout: 1000 })
  })
  await test.step(${JSON.stringify(titles[1])}, async () => {
    await expect(page.getByRole(${second === 'heading' ? "'heading', { name: 'Invoices' }" : "'button', { name: 'Export' }"})).toBeVisible({ timeout: 1000 })
  })
})
`
const seedOf = (body: string): string =>
  `import type { SeedContext } from './flow'\n\nexport async function seed({ unique }: SeedContext) {\n${body}\n}\n`
const GOOD_SEED = seedOf('  return { owner: `owner-${unique}` }')

let server: http.Server
let root: string
let world: FlowTestWorld

beforeAll(async () => {
  server = http.createServer((_req, res) => res.setHeader('content-type', 'text/html').end('<h1>Invoices</h1>'))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  world = {
    id: 'tc-flow-test-session',
    world: { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, urls: {}, accounts: [] },
  }
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-flow-test-session-'))
  fs.mkdirSync(worldDir(root), { recursive: true })
  fs.writeFileSync(worldStatePath(root), JSON.stringify(world.world))
})

beforeEach(() => {
  fs.rmSync(flowTestsDir(root), { recursive: true, force: true })
  fs.mkdirSync(flowTestsDir(root), { recursive: true })
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  fs.rmSync(root, { recursive: true, force: true })
})

function write(files: { spec?: string; seed?: string }): void {
  if (files.spec !== undefined) fs.writeFileSync(flowTestPath(root, FLOW.id), files.spec)
  if (files.seed !== undefined) fs.writeFileSync(flowSeedPath(root, FLOW.id), files.seed)
}

type Verdict = { verdict: 'faithful' } | { verdict: 'flagged'; flagged: Array<{ step: number; mismatch: string }>; confidence: 'high' }

/** A session over the tree, with a judge that answers `verdict` and counts how often it was asked. */
function session(opts: { verdict?: Verdict; prior?: FlowTestPrior } = {}) {
  const input: FlowTestSessionInput = { repoRoot: root, flow: FLOW, steps: STEPS, world, ...(opts.prior ? { prior: opts.prior } : {}) }
  const { def, state } = flowTestSessionDef(input)
  const judge = { asked: 0, briefings: [] as string[] }
  const ctx = {
    workItem: `flow:${FLOW.id}`,
    signal: new AbortController().signal,
    dispatchChild: async (_def: unknown, messages: readonly string[]) => {
      judge.asked += 1
      judge.briefings.push(messages.join('\n'))
      return { status: 'completed', output: opts.verdict ?? { verdict: 'faithful' }, pendingQuestions: [], spent: { turns: 1, tokens: 100, costUsd: 0.01 } }
    },
  }
  const tool = (name: string) => def.tools.find((t) => t.name === name)!
  return {
    state,
    judge,
    briefing: () => flowTestBriefing(input),
    review: (args: { copyDrift?: FlowTestCopyDrift[] } = {}) => tool('review_test').execute(args, ctx as never),
    give: (outcome: FlowTestOutcome) => Promise.resolve(def.validateOutcome?.(outcome, { wrappingUp: false })),
  }
}

const record = (status: FlowTestRecord['status'], extra: Partial<FlowTestRecord> = {}): FlowTestRecord => ({
  flowId: FLOW.id,
  flowFingerprint: 'fp',
  status,
  file: 'see-invoices.spec.ts',
  seed: 'see-invoices.seed.ts',
  summary: 'the invoices test',
  ...extra,
})

describe('the flow-test session gate', () => {
  it('accepts a passing test only once the judge accepted the files as they are', async () => {
    write({ spec: specOf('heading'), seed: GOOD_SEED })
    const s = session()

    expect(await s.give(PASSING)).toContain('`review_test` has not accepted')
    expect(s.state.judged()).toBeUndefined()

    const reviewed = await s.review()
    expect(reviewed.isError).toBeFalsy()
    expect(reviewed.content).toContain('FAITHFUL')
    // The judge was shown the claims, the files, and how the engine's run of them went.
    expect(s.judge.briefings[0]).toContain('1. The invoices page lists invoices')
    expect(s.judge.briefings[0]).toContain('claim: Opening Invoices shows the list.')
    expect(s.judge.briefings[0]).toContain('| The Invoices page lists every invoice.')
    expect(s.judge.briefings[0]).toContain("getByRole('heading', { name: 'Invoices' })")
    expect(s.judge.briefings[0]).toContain('export async function seed')
    expect(s.judge.briefings[0]).toMatch(/last run of these files PASSED[\s\S]*1\. passed\n2\. passed/)

    expect(await s.give(PASSING)).toBeUndefined()
    expect(s.state.judged()).toBe(flowTestJudgeKey({ steps: STEPS, spec: specOf('heading'), seed: GOOD_SEED }))
    expect(s.state.judgeSpent()).toEqual({ sessions: 1, turns: 1, tokens: 100, costUsd: 0.01 })

    // An edit after the review is a file nobody read.
    write({ seed: seedOf('  return { owner: `someone-${unique}` }') })
    expect(await s.give(PASSING)).toContain('`review_test` has not accepted')
    expect(s.state.judged()).toBeUndefined()
  }, 120_000)

  it('refuses what the judge flagged, and does not ask again about files that have not changed', async () => {
    write({ spec: specOf('heading'), seed: GOOD_SEED })
    const s = session({ verdict: { verdict: 'flagged', flagged: [{ step: 2, mismatch: 'asserts the heading again, never the Export button' }], confidence: 'high' } })

    const first = await s.review()
    expect(first.isError).toBe(true)
    expect(first.content).toContain('step 2: asserts the heading again, never the Export button')
    const again = await s.review()
    expect(again.content).toContain('the files have not changed since this verdict')
    expect(s.judge.asked).toBe(1)

    const refusal = await s.give(PASSING)
    expect(refusal).toContain('did not accept them')
    expect(refusal).toContain('step 2: asserts the heading again')
    expect(s.state.flagged()).toBe('step 2: asserts the heading again, never the Export button')
  }, 120_000)

  it('accepts a failing test only when the test fails, never when its seed does', async () => {
    write({ spec: specOf('export'), seed: GOOD_SEED })
    const s = session()
    await s.review()
    // For a failing test the judge reads the failing assertion: it is told which step failed, and how.
    expect(s.judge.briefings[0]).toMatch(/last run of these files FAILED[\s\S]*1\. passed\n2\. FAILED/)
    expect(s.judge.briefings[0]).toContain("getByRole('button', { name: 'Export' })")
    expect(await s.give(FAILING)).toBeUndefined()

    write({ seed: seedOf('  throw new Error(`sign-up for owner-${unique} answered 500`)') })
    const reviewed = await s.review()
    expect(reviewed.isError).toBe(true)
    expect(reviewed.content).toContain('no run of the test to judge')
    expect(reviewed.content).toContain('answered 500')
    expect(s.judge.asked).toBe(1)
  }, 120_000)

  it("holds the spec's steps to the flow's claim titles, in order, before running anything", async () => {
    const s = session()

    write({ spec: specOf('heading', ['open the invoices page', STEPS[1].claimTitle]), seed: GOOD_SEED })
    const renamed = await s.give(PASSING)
    expect(renamed).toContain("The spec's `test.step` calls are not the flow's steps")
    expect(renamed).toContain('  1. The invoices page lists invoices')
    expect(renamed).toContain('  1. open the invoices page')

    write({ spec: specOf('heading', [STEPS[1].claimTitle, STEPS[0].claimTitle]) })
    expect(await s.give(PASSING)).toContain("are not the flow's steps")

    // One step standing for two claims is not the flow's steps either.
    write({ spec: specOf('heading').replace(/  await test\.step\("The page offers[\s\S]*?\n  \}\)\n/, '') })
    expect(await s.give(PASSING)).toContain("are not the flow's steps")
    expect((await s.review()).content).toContain("are not the flow's steps")
    expect(s.judge.asked).toBe(0)
  })

  it('refuses a seed that names things without `unique`, before running anything', async () => {
    write({
      spec: specOf('heading'),
      seed: `import type { SeedContext } from './flow'\n\nexport async function seed(_: SeedContext) {\n  return { owner: 'owner@example.com' }\n}\n`,
    })
    expect(await session().give(PASSING)).toContain('never uses `unique`')
  })

  it('refuses a seed its spec does not run', async () => {
    write({
      spec: specOf('heading').replace(SPEC_HEAD, `import { test, expect } from './flow'\n`),
      seed: GOOD_SEED,
    })
    expect(await session().give(PASSING)).toContain('the spec does not run it')
  })

  it('holds a blocked flow to leaving neither spec nor seed', async () => {
    write({ seed: GOOD_SEED })
    const s = session()
    expect(await s.give(BLOCKED)).toContain('see-invoices.seed.ts')

    fs.rmSync(flowSeedPath(root, FLOW.id))
    expect(await s.give(BLOCKED)).toBeUndefined()
  })
})

describe('copy drift', () => {
  const drift: FlowTestCopyDrift[] = [{ step: 2, documented: 'Export', observed: 'Invoices' }]

  it('is read by the judge as declared, and an outcome stands only on the list the judge was given', async () => {
    write({ spec: specOf('heading'), seed: GOOD_SEED })
    const s = session()

    expect((await s.review({ copyDrift: drift })).content).toContain('FAITHFUL')
    expect(s.judge.briefings[0]).toContain('- step 2: the document says "Export", the product has "Invoices"')

    // The verdict was given knowing that list. An outcome that reports none has no verdict.
    expect(await s.give(PASSING)).toContain('`review_test` has not accepted')
    expect(await s.give({ ...PASSING, copyDrift: drift })).toBeUndefined()
    expect(s.state.judged(drift)).toBe(flowTestJudgeKey({ steps: STEPS, spec: specOf('heading'), seed: GOOD_SEED, copyDrift: drift }))
    expect(s.state.judged()).toBeUndefined()
    expect(s.judge.asked).toBe(1)
  }, 120_000)

  it('is refused on a step the flow does not have, before the judge is asked', async () => {
    write({ spec: specOf('heading'), seed: GOOD_SEED })
    const s = session()
    const stray: FlowTestCopyDrift[] = [{ step: 3, documented: 'Export', observed: 'Download' }]

    const reviewed = await s.review({ copyDrift: stray })
    expect(reviewed.isError).toBe(true)
    expect(reviewed.content).toContain('`copyDrift` names step 3')
    expect(s.judge.asked).toBe(0)
    expect(await s.give({ ...PASSING, copyDrift: stray })).toContain('`copyDrift` names step 3')
  })

  it('keys a verdict only when there is some, in whatever order it is given', () => {
    const files = { steps: STEPS, spec: specOf('heading'), seed: GOOD_SEED }
    const two: FlowTestCopyDrift[] = [...drift, { step: 1, documented: 'Bills', observed: 'Invoices' }]

    expect(flowTestJudgeKey({ ...files, copyDrift: [] })).toBe(flowTestJudgeKey(files))
    expect(flowTestJudgeKey({ ...files, copyDrift: drift })).not.toBe(flowTestJudgeKey(files))
    expect(flowTestJudgeKey({ ...files, copyDrift: two })).toBe(flowTestJudgeKey({ ...files, copyDrift: [...two].reverse() }))
  })

  it('is handed to a session opened on the test again', () => {
    const prior: FlowTestPrior = { reason: 'moved', record: record('passing', { copyDrift: drift }), spec: specOf('heading'), seed: GOOD_SEED }
    expect(session({ prior }).briefing()).toContain('- step 2: the document says "Export", the product has "Invoices"')
  })
})

describe('a session opened on a flow that already has a test', () => {
  const accepted = { spec: specOf('heading'), seed: GOOD_SEED }
  const judged = flowTestJudgeKey({ steps: STEPS, ...accepted })

  it('keeps a failing test that now passes exactly as it was, and accepts the pass on the verdict it already has', async () => {
    write(accepted)
    const prior: FlowTestPrior = {
      reason: 'now-passing',
      record: record('failing', { judged, disagreement: FAILING.disagreement!, run: { ranAt: '2026-01-01T00:00:00.000Z', durationMs: 1, commit: 'aaaaaaaaaaaa1111', steps: [{ order: 1, title: STEPS[0].claimTitle, outcome: 'passed' }, { order: 2, title: STEPS[1].claimTitle, outcome: 'failed' }] } }),
      ...accepted,
      diffBase: 'aaaaaaaaaaaa1111',
    }
    const s = session({ prior })

    const briefing = s.briefing()
    expect(briefing).toContain('# Why this session was opened')
    expect(briefing).toContain('accepted FAILING on a disagreement')
    expect(briefing).toContain('at commit aaaaaaaaaaaa')
    expect(briefing).toContain('`git diff aaaaaaaaaaaa1111 HEAD`')
    expect(briefing).toContain(`  2. FAILED: ${STEPS[1].claimTitle}`)

    // An edit to either file is undone before anything runs.
    write({ spec: specOf('heading').replace('timeout: 1000', 'timeout: 2000'), seed: seedOf('  return { owner: `other-${unique}` }') })
    const refusal = await s.give(PASSING)
    expect(refusal).toMatch(/see-invoices\.spec\.ts and .*see-invoices\.seed\.ts were not as accepted, and have been put back byte for byte/)
    expect(fs.readFileSync(flowTestPath(root, FLOW.id), 'utf-8')).toBe(accepted.spec)
    expect(fs.readFileSync(flowSeedPath(root, FLOW.id), 'utf-8')).toBe(accepted.seed)

    // The files are the ones the judge already accepted: no second reading.
    expect(await s.give(PASSING)).toBeUndefined()
    expect(s.judge.asked).toBe(0)
    expect(s.state.judged()).toBe(judged)
  }, 120_000)

  it('lets a seed repair change the seed and nothing else', async () => {
    write(accepted)
    const prior: FlowTestPrior = {
      reason: 'seed-failed',
      record: record('passing', { judged }),
      ...accepted,
      rerun: { flowId: FLOW.id, file: 'see-invoices.spec.ts', outcome: 'seed-failed', durationMs: 5, error: 'Error: sign-up answered 404', steps: [], attachments: [] },
    }
    const s = session({ prior })
    expect(s.briefing()).toContain('its seed no longer holds')
    expect(s.briefing()).toContain('| Error: sign-up answered 404')

    write({ spec: specOf('export'), seed: seedOf('  return { owner: `repaired-${unique}` }') })
    expect(await s.give(PASSING)).toMatch(/see-invoices\.spec\.ts was not as accepted, and has been put back/)
    expect(fs.readFileSync(flowTestPath(root, FLOW.id), 'utf-8')).toBe(accepted.spec)
    expect(fs.readFileSync(flowSeedPath(root, FLOW.id), 'utf-8')).toContain('repaired-')

    // The repaired seed is a file the judge has not read.
    expect(await s.give(PASSING)).toContain('`review_test` has not accepted')
    await s.review()
    expect(await s.give(PASSING)).toBeUndefined()
  }, 120_000)

  it('tells a session whose flow changed which steps are new, gone, moved or the same', () => {
    const prior: FlowTestPrior = {
      reason: 'flow-changed',
      record: record('passing', {
        run: {
          ranAt: '2026-01-01T00:00:00.000Z',
          durationMs: 1,
          steps: [
            { order: 1, title: "The page offers an 'Export' button", outcome: 'passed' },
            { order: 2, title: 'An invoice can be voided', outcome: 'passed' },
            { order: 3, title: 'The invoices page lists invoices', outcome: 'passed' },
          ],
        },
      }),
      ...accepted,
    }
    const briefing = session({ prior }).briefing()
    expect(briefing).toContain('The flow changed since its test was written')
    expect(briefing).toContain('  1. MOVED (was step 3): The invoices page lists invoices')
    expect(briefing).toContain("  2. MOVED (was step 1): The page offers an 'Export' button")
    expect(briefing).toContain('  - GONE: An invoice can be voided')
    expect(briefing).toContain('Leave the code of a step whose claim is the same exactly as it is')
  })

  it('gives a blocked flow that changed the words it was blocked on', () => {
    const prior: FlowTestPrior = { reason: 'flow-changed', record: { flowId: FLOW.id, flowFingerprint: 'fp', status: 'blocked', summary: 's', blockedBy: 'no Stripe account', blockedOn: 'Stripe account' } }
    const briefing = session({ prior }).briefing()
    expect(briefing).toContain('It was recorded as blocked on: Stripe account (no Stripe account)')
    expect(briefing).toContain('say so in the same words')
  })

  it('tells a moved test where it fails now, and a flagged one what the judge refused', () => {
    const rerun = {
      flowId: FLOW.id,
      file: 'see-invoices.spec.ts',
      outcome: 'fail' as const,
      durationMs: 5,
      error: "Error: expect(locator).toBeVisible() failed\nLocator: getByRole('heading', { name: 'Invoices' })",
      steps: [{ order: 1, title: STEPS[0].claimTitle, outcome: 'failed' as const }],
      attachments: [{ name: 'trace', path: '.truecourse/tests/results/run/artifacts/trace.zip' }],
    }
    const moved = session({ prior: { reason: 'moved', record: record('passing', { judged }), ...accepted, rerun } }).briefing()
    expect(moved).toContain('It was accepted passing, and at this commit it fails, at step 1.')
    expect(moved).toContain("| Locator: getByRole('heading', { name: 'Invoices' })")
    expect(moved).toContain('The trace of that run: .truecourse/tests/results/run/artifacts/trace.zip')
    expect(moved).toContain('Never make this test pass by asserting less')
    expect(moved).not.toContain('git diff')

    const flagged = session({
      prior: { reason: 'judge-flagged', record: record('passing'), ...accepted, flagged: [{ step: 2, mismatch: 'never looks for the Export button' }] },
    }).briefing()
    expect(flagged).toContain('- step 2: never looks for the Export button')
    expect(flagged).toContain('Leave the steps the review did not name exactly as they are')
  })
})
