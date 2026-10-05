/**
 * The flow-test stage over a tree that already has tests: every kept test is
 * run again at this commit by real Playwright against a product brought up
 * once from its world scripts (a one-file HTTP server here), the judge reads
 * the ones nobody has judged, and each test that moved or was refused gets a
 * session with its reason. The sessions and the judge run on a scripted
 * driver, so what is under test is what the stage decides and records.
 */
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  DriverResult,
  SessionDriver,
  SessionEvent,
  SessionPersistence,
  SessionRunInput,
} from '@truecourse/agent-loop'
import type { FlowTestRecord, FlowTestsFile, GuardFlow } from '@truecourse/shared'
import {
  flowTestPath,
  flowTestsDir,
  flowTestsIndexPath,
  guardFlowsPath,
  worldDir,
  worldScriptPath,
} from '@truecourse/shared/work-tree'
import { runFlowTestStage, readFlowTests } from '../../packages/core/dist/services/product-world/flow-test-stage.js'
import { flowTestJudgeKey } from '../../packages/core/dist/services/product-world/flow-test-fidelity.js'
import { flowStepReader } from '../../packages/core/dist/services/product-world/flow-test-steps.js'

const SERVER = `
const http = require('node:http')
http.createServer((req, res) => res.setHeader('content-type', 'text/html').end('<h1>Invoices</h1>')).listen(Number(process.argv[2]), '127.0.0.1')
`
const BUILD = `echo build >> events.log\n`
const UP = `
set -e
echo up >> events.log
PORT=$(echo "$TC_PORTS" | cut -d' ' -f1)
nohup node server.js "$PORT" > "$TC_WORLD_LOGS/server.log" 2>&1 &
echo $! > .truecourse/world/server.pid
echo "{ \\"baseUrl\\": \\"http://127.0.0.1:$PORT\\" }" > "$TC_WORLD_FILE"
`
const DOWN = `
echo down >> events.log
if [ -f .truecourse/world/server.pid ]; then kill "$(cat .truecourse/world/server.pid)" 2>/dev/null || true; fi
`

const claimOf = (id: string): string => `The ${id} claim holds`

function flow(id: string, fingerprint = `sha256:${id}`): GuardFlow {
  return {
    id,
    title: `Flow ${id}`,
    goal: `A person does ${id}.`,
    fingerprint,
    milestones: [{ order: 1, doc: 'docs/billing.md', anchor: id, claimTitle: claimOf(id) }],
    bindings: [{ doc: 'docs/billing.md', anchor: id, fingerprint: `sha256:section-${id}` }],
    composedOf: [],
    synthesisInputsHash: `inputs-${id}`,
  }
}

/** A flow's one-step spec: it sees the heading the page has, or looks for a button it lacks. */
const spec = (id: string, sees: 'heading' | 'export', note = ''): string => `import { test, expect } from './flow'
${note}
test('${id}', async ({ page }) => {
  await test.step(${JSON.stringify(claimOf(id))}, async () => {
    await page.goto('/')
    await expect(page.getByRole(${sees === 'heading' ? "'heading', { name: 'Invoices' }" : "'button', { name: 'Export' }"})).toBeVisible({ timeout: 1000 })
  })
})
`

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

/** A work tree with the world scripts, the flow corpus, and whatever tests it already has. */
function tree(flows: GuardFlow[], specs: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-flow-test-stage-'))
  roots.push(root)
  fs.writeFileSync(path.join(root, 'server.js'), SERVER)
  fs.mkdirSync(worldDir(root), { recursive: true })
  fs.writeFileSync(worldScriptPath(root, 'build'), BUILD)
  fs.writeFileSync(worldScriptPath(root, 'up'), UP)
  fs.writeFileSync(worldScriptPath(root, 'down'), DOWN)
  fs.mkdirSync(path.dirname(guardFlowsPath(root)), { recursive: true })
  fs.writeFileSync(guardFlowsPath(root), JSON.stringify({ version: 1, generatedAt: '2026-01-01T00:00:00.000Z', flows, noFlowClaims: [] }))
  fs.mkdirSync(flowTestsDir(root), { recursive: true })
  for (const [id, body] of Object.entries(specs)) fs.writeFileSync(flowTestPath(root, id), body)
  return root
}

function index(root: string, tests: FlowTestRecord[]): void {
  const file: FlowTestsFile = { version: 1, generatedAt: '2026-01-01T00:00:00.000Z', tests }
  fs.writeFileSync(flowTestsIndexPath(root), `${JSON.stringify(file, null, 2)}\n`)
}

/** A kept record of `id`'s test as the tree has it, accepted at an earlier commit. */
function kept(root: string, f: GuardFlow, status: 'passing' | 'failing', opts: { judged?: boolean } = {}): FlowTestRecord {
  const source = fs.readFileSync(flowTestPath(root, f.id), 'utf-8')
  return {
    flowId: f.id,
    flowFingerprint: f.fingerprint,
    status,
    file: `${f.id}.spec.ts`,
    summary: `the ${f.id} test`,
    ...(status === 'failing' ? { disagreement: { documented: 'billing.md: an export', observed: 'no export' } } : {}),
    run: {
      ranAt: '2026-01-01T00:00:00.000Z',
      durationMs: 10,
      commit: 'old111',
      steps: [{ order: 1, title: claimOf(f.id), outcome: status === 'passing' ? 'passed' : 'failed' }],
      ...(status === 'failing' ? { error: 'Error: expect(locator).toBeVisible() failed' } : {}),
    },
    ...(opts.judged === false ? {} : { judged: flowTestJudgeKey({ steps: flowStepReader(root)(f), spec: source }) }),
  }
}

const events = (root: string): string[] => fs.readFileSync(path.join(root, 'events.log'), 'utf-8').trim().split('\n')

/** What a scripted flow-test session does: act on the tree and its tools, then end. */
type FlowScript = (ctx: { input: SessionRunInput; tool: (name: string) => Promise<{ content: string; isError?: boolean }> }) => Promise<DriverResult>

const gaveUp: DriverResult = { kind: 'failure', failure: { kind: 'budget-exhausted', retryability: 'none' } }

/**
 * A driver whose flow-test sessions follow `scripts` by flow id, and whose
 * judge flags step 1 of any test of the flow named `flagged` until its spec
 * says REPAIRED.
 */
function scripted(scripts: Record<string, FlowScript>) {
  const briefings = new Map<string, string>()
  const judgedFlows: string[] = []
  const driver: SessionDriver = {
    capabilities: { steering: 'turn-boundary', structuredOutcome: 'tool', resumeAtMessage: false },
    attribution: { provider: 'test', model: 'scripted' },
    runSession(input) {
      const done = (async (): Promise<DriverResult> => {
        await new Promise((resolve) => setTimeout(resolve, 0))
        for (const message of input.initialMessages) input.onEvent({ type: 'user-message', content: message })
        const briefing = input.initialMessages[0] ?? ''
        const flowId = /\(([a-z-]+)\)\.\n/.exec(briefing)?.[1] ?? ''
        if (input.def.kind === 'guard-generate.flow-test-fidelity') {
          judgedFlows.push(flowId)
          return flowId === 'flagged' && !briefing.includes('REPAIRED')
            ? { kind: 'outcome', value: { verdict: 'flagged', flagged: [{ step: 1, mismatch: 'sees only a heading' }], confidence: 'high' } }
            : { kind: 'outcome', value: { verdict: 'faithful' } }
        }
        briefings.set(flowId, briefing)
        const script = scripts[flowId]
        if (!script) throw new Error(`no script for a session on ${flowId}`)
        return script({
          input,
          tool: (name) => input.def.tools.find((t) => t.name === name)!.execute({}, {} as never),
        })
      })()
      return { done, status: () => 'running' as const, steer: () => {}, interrupt: async () => {} }
    },
  }
  const stored = new Map<string, SessionEvent[]>()
  const persistence: SessionPersistence = {
    appendEvent: (sessionId, event) => void stored.set(sessionId, [...(stored.get(sessionId) ?? []), event]),
    updateIndex: () => {},
    readEvents: (sessionId) => stored.get(sessionId) ?? [],
  }
  let acquired = 0
  return {
    briefings,
    judgedFlows,
    acquired: () => acquired,
    acquire: async () => {
      acquired += 1
      return { driver, persistence }
    },
  }
}

describe('the flow-test stage, on a tree that already has tests', () => {
  it('runs every kept test again, opens a session for each that moved or was refused, and leaves a run', async () => {
    const ids = ['holds', 'regressed', 'stuck', 'fixed', 'unjudged', 'flagged', 'fresh', 'pay', 'changed']
    const flows = ids.map((id) => flow(id))
    const by = new Map(flows.map((f) => [f.id, f]))
    const root = tree(flows, {
      holds: spec('holds', 'heading'),
      regressed: spec('regressed', 'export'),
      stuck: spec('stuck', 'export'),
      fixed: spec('fixed', 'heading'),
      unjudged: spec('unjudged', 'heading'),
      flagged: spec('flagged', 'heading'),
      changed: spec('changed', 'heading'),
    })
    const stuckBefore = kept(root, by.get('stuck')!, 'passing')
    index(root, [
      kept(root, by.get('holds')!, 'passing'),
      kept(root, by.get('regressed')!, 'passing'),
      stuckBefore,
      kept(root, by.get('fixed')!, 'failing'),
      kept(root, by.get('unjudged')!, 'passing', { judged: false }),
      kept(root, by.get('flagged')!, 'passing', { judged: false }),
      { flowId: 'pay', flowFingerprint: 'sha256:pay', status: 'blocked', summary: 'needs a provider', blockedBy: 'no Stripe account', blockedOn: 'Stripe account' },
      { ...kept(root, by.get('changed')!, 'passing'), flowFingerprint: 'sha256:changed-before' },
    ])

    const fetchedCommits: string[] = []
    const model = scripted({
      // The product stopped doing it: the assertion stays, and the test is kept as the finding.
      regressed: async ({ tool }) => {
        expect((await tool('review_test')).content).toContain('FAITHFUL')
        return { kind: 'outcome', value: { status: 'failing', summary: 'The page has no export.', disagreement: { documented: 'billing.md: an export', observed: 'no Export button' } } }
      },
      // Mangles the spec, then runs out of budget.
      stuck: async () => {
        fs.writeFileSync(flowTestPath(root, 'stuck'), '// half an edit\n')
        return gaveUp
      },
      // Frozen files, a verdict that still stands: the pass is confirmed and nothing else.
      fixed: async () => ({ kind: 'outcome', value: { status: 'passing', summary: 'The page now has what the document says.' } }),
      flagged: async ({ tool }) => {
        fs.writeFileSync(flowTestPath(root, 'flagged'), spec('flagged', 'heading', '// REPAIRED'))
        expect((await tool('review_test')).content).toContain('FAITHFUL')
        return { kind: 'outcome', value: { status: 'passing', summary: 'The step now observes the claim.' } }
      },
      fresh: async ({ tool }) => {
        fs.writeFileSync(flowTestPath(root, 'fresh'), spec('fresh', 'heading'))
        expect((await tool('review_test')).content).toContain('FAITHFUL')
        return { kind: 'outcome', value: { status: 'passing', summary: 'The page lists invoices.' } }
      },
      changed: async () => gaveUp,
    })

    const result = await runFlowTestStage({
      repoRoot: root,
      worldId: 'tc-flow-test-stage',
      runId: 'generate-run',
      commit: 'head222',
      fetchCommit: async (commit) => {
        fetchedCommits.push(commit)
        return true
      },
      acquire: model.acquire,
      concurrency: 3,
    })
    if (result.status !== 'ok') throw new Error(`${result.status}: ${'reason' in result ? result.reason : ''}`)

    // One product for the rerun and every session.
    expect(events(root)).toEqual(['build', 'down', 'up', 'down'])

    // The judge read the two tests nobody had judged, and the two a session then asked it about.
    expect(result.judged).toEqual({ read: 2, flagged: 1, unavailable: 0 })
    expect(model.judgedFlows.slice(0, 2).sort()).toEqual(['flagged', 'unjudged'])

    // Sessions: the three that moved, the one refused, the new flow and the changed one. Never the ones that held.
    expect([...model.briefings.keys()].sort()).toEqual(['changed', 'fixed', 'flagged', 'fresh', 'regressed', 'stuck'])
    expect(result.authored).toBe(6)
    expect(model.briefings.get('regressed')).toContain('It was accepted passing, and at this commit it fails, at step 1.')
    expect(model.briefings.get('regressed')).toContain('`git diff old111 HEAD`')
    expect(model.briefings.get('fixed')).toContain('accepted FAILING on a disagreement')
    expect(model.briefings.get('flagged')).toContain('- step 1: sees only a heading')
    expect(model.briefings.get('changed')).toContain('The flow changed since its test was written')
    expect(model.briefings.get('fresh')).not.toContain('# Why this session was opened')
    // One fetch per distinct accepted commit, however many tests moved off it.
    expect(fetchedCommits).toEqual(['old111'])

    // The two the same change moved the same way are one group, listed first.
    expect(result.moved.map((m) => [m.flowId, m.reason, m.settled])).toEqual([
      ['regressed', 'moved', 'failing'],
      ['stuck', 'moved', 'unsettled'],
      ['fixed', 'now-passing', 'passing'],
    ])
    expect(result.moved[0].signature).toBe(result.moved[1].signature)
    expect(result.unsettled.map((u) => u.flowId).sort()).toEqual(['changed', 'stuck'])

    const records = new Map(readFlowTests(root).tests.map((t) => [t.flowId, t]))
    expect([...records.keys()]).toEqual(['holds', 'regressed', 'stuck', 'fixed', 'unjudged', 'flagged', 'fresh', 'pay'])
    expect(records.get('regressed')).toMatchObject({ status: 'failing', disagreement: { observed: 'no Export button' }, run: { commit: 'head222' } })
    expect(records.get('fixed')).toMatchObject({ status: 'passing', run: { commit: 'head222' } })
    expect(records.get('fixed')!.disagreement).toBeUndefined()
    // A session that settled nothing leaves the test that was accepted, record and files.
    expect(records.get('stuck')).toEqual(stuckBefore)
    expect(fs.readFileSync(flowTestPath(root, 'stuck'), 'utf-8')).toBe(spec('stuck', 'export'))
    // A changed flow whose session settled nothing has no test: the old one proved another flow.
    expect(fs.existsSync(flowTestPath(root, 'changed'))).toBe(false)
    // A faithful verdict stamps the record, with no session.
    const steps = flowStepReader(root)
    expect(records.get('unjudged')!.judged).toBe(flowTestJudgeKey({ steps: steps(by.get('unjudged')!), spec: spec('unjudged', 'heading') }))
    expect(records.get('unjudged')!.run!.commit).toBe('old111')
    expect(records.get('flagged')!.judged).toBe(flowTestJudgeKey({ steps: steps(by.get('flagged')!), spec: spec('flagged', 'heading', '// REPAIRED') }))
    expect(records.get('fresh')).toMatchObject({ status: 'passing', file: 'fresh.spec.ts' })
    expect(records.get('fresh')!.judged).toBeDefined()

    // The run: one result per test with a spec, as it stands at this commit.
    const run = result.run!
    const ran = new Map(run.results.map((r) => [r.flowId, r]))
    expect([...ran.keys()]).toEqual(['holds', 'regressed', 'stuck', 'fixed', 'unjudged', 'flagged', 'fresh'])
    // Held: the rerun, with no evidence of its own.
    expect(ran.get('holds')).toMatchObject({ authored: 'passing', outcome: 'pass', run: { commit: 'head222' } })
    expect(ran.get('holds')!.run.evidencePath).toBeUndefined()
    expect(ran.get('unjudged')!.run.evidencePath).toBeUndefined()
    // Moved and unsettled: the rerun, disagreeing with the record, with its pictures.
    expect(ran.get('stuck')).toMatchObject({ authored: 'passing', outcome: 'fail' })
    expect(ran.get('stuck')!.run.evidencePath).toBe(`.truecourse/guard/evidence/${run.runId}/stuck`)
    expect(fs.readdirSync(path.join(root, ran.get('stuck')!.run.evidencePath!))).toContain('step-1.png')
    // Written or repaired here: the run its status was accepted on.
    expect(ran.get('regressed')).toMatchObject({ authored: 'failing', outcome: 'fail' })
    expect(ran.get('regressed')!.run).toEqual(records.get('regressed')!.run)
    expect(ran.get('regressed')!.run.evidencePath).toBe('.truecourse/guard/evidence/generate-run/regressed')
    expect(ran.get('fixed')).toMatchObject({ authored: 'passing', outcome: 'pass' })
    expect(ran.get('fresh')).toMatchObject({ authored: 'passing', outcome: 'pass' })
  }, 240_000)

  it('reruns tests that all hold without a model, and stores nothing new about them', async () => {
    const flows = [flow('holds'), flow('still-failing')]
    const root = tree(flows, { holds: spec('holds', 'heading'), 'still-failing': spec('still-failing', 'export') })
    const before = [kept(root, flows[0], 'passing'), kept(root, flows[1], 'failing')]
    index(root, before)
    const model = scripted({})

    const result = await runFlowTestStage({ repoRoot: root, worldId: 'tc-flow-test-stage', runId: 'generate-run', commit: 'head222', acquire: model.acquire })
    if (result.status !== 'ok') throw new Error(result.status)

    expect(model.acquired()).toBe(0)
    expect(events(root)).toEqual(['build', 'down', 'up', 'down'])
    expect(result).toMatchObject({ authored: 0, moved: [], unsettled: [], judged: { read: 0 } })
    // A failing test that fails at the step it was accepted failing at holds.
    expect(result.run!.results.map((r) => [r.flowId, r.authored, r.outcome])).toEqual([
      ['holds', 'passing', 'pass'],
      ['still-failing', 'failing', 'fail'],
    ])
    expect(readFlowTests(root).tests).toEqual(before)
  }, 120_000)

  it('never brings the product up when every flow is blocked and nothing changed', async () => {
    const root = tree([flow('pay')], {})
    index(root, [{ flowId: 'pay', flowFingerprint: 'sha256:pay', status: 'blocked', summary: 'needs a provider', blockedBy: 'no Stripe account', blockedOn: 'Stripe account' }])
    const model = scripted({})

    const result = await runFlowTestStage({ repoRoot: root, worldId: 'tc-flow-test-stage', runId: 'generate-run', acquire: model.acquire })

    expect(result).toMatchObject({ status: 'ok', authored: 0 })
    expect(result.status === 'ok' && result.run).toBeUndefined()
    expect(fs.existsSync(path.join(root, 'events.log'))).toBe(false)
  })

  it('writes a test again when its spec is not stepped by the flow\'s claims', async () => {
    const f = flow('legacy')
    const root = tree([f], { legacy: spec('legacy', 'heading').replace(JSON.stringify(claimOf('legacy')), "'open the page'") })
    index(root, [kept(root, f, 'passing')])
    const model = scripted({
      legacy: async ({ tool }) => {
        fs.writeFileSync(flowTestPath(root, 'legacy'), spec('legacy', 'heading'))
        await tool('review_test')
        return { kind: 'outcome', value: { status: 'passing', summary: 'Stepped by its claim.' } }
      },
    })

    const result = await runFlowTestStage({ repoRoot: root, worldId: 'tc-flow-test-stage', runId: 'generate-run', acquire: model.acquire })

    expect(result).toMatchObject({ status: 'ok', authored: 1, moved: [] })
    expect(model.briefings.get('legacy')).not.toContain('# Why this session was opened')
    expect(readFlowTests(root).tests[0].run!.steps.map((s) => s.title)).toEqual([claimOf('legacy')])
  }, 120_000)
})
