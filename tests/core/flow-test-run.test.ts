/**
 * A run of the stored flow tests: the product brought up once from its world
 * scripts (a one-file HTTP server here), every test with a spec run against it
 * by real Playwright, the product taken down, and each result set beside the
 * status the test was authored with. The tests index is never rewritten.
 */
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { tallyFlowTestRun, type FlowTestRecord, type FlowTestsFile } from '@truecourse/shared'
import { flowTestsDir, flowTestsIndexPath, worldDir, worldScriptPath } from '@truecourse/shared/work-tree'
import { runStoredFlowTests } from '../../packages/core/dist/services/product-world/flow-test-run.js'

const SERVER = `
const http = require('node:http')
http.createServer((req, res) => res.setHeader('content-type', 'text/html').end('<h1>Invoices</h1>')).listen(Number(process.argv[2]), '127.0.0.1')
`

/** Each script leaves a line in `events.log`, so a test can tell how often each ran. */
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

const SEES_HEADING = `test('the invoices page is there', async ({ page }) => {
  await test.step('open the invoices page', async () => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible()
  })
})`
const SEES_EXPORT = `test('the invoices page offers an export', async ({ page }) => {
  await test.step('open the invoices page', async () => {
    await page.goto('/')
  })
  await test.step('export', async () => {
    await expect(page.getByRole('button', { name: 'Export' })).toBeVisible({ timeout: 1000 })
  })
})`

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function record(flowId: string, status: FlowTestRecord['status'], extra: Partial<FlowTestRecord> = {}): FlowTestRecord {
  return {
    flowId,
    flowFingerprint: `fp-${flowId}`,
    status,
    ...(status === 'blocked' ? { blockedBy: 'no payment provider', blockedOn: 'Stripe account' } : { file: `${flowId}.spec.ts` }),
    summary: `the ${flowId} test`,
    ...(status === 'failing' ? { disagreement: { documented: 'billing.md: an export', observed: 'no export' } } : {}),
    ...extra,
  }
}

/** A work tree holding the world scripts, the specs and seeds, and the tests index. */
function tree(opts: { build?: string; specs: Record<string, string>; tests: FlowTestRecord[] }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-flow-test-run-'))
  roots.push(root)
  fs.writeFileSync(path.join(root, 'server.js'), SERVER)
  fs.mkdirSync(worldDir(root), { recursive: true })
  fs.writeFileSync(worldScriptPath(root, 'build'), opts.build ?? BUILD)
  fs.writeFileSync(worldScriptPath(root, 'up'), UP)
  fs.writeFileSync(worldScriptPath(root, 'down'), DOWN)
  fs.mkdirSync(flowTestsDir(root), { recursive: true })
  for (const [file, body] of Object.entries(opts.specs)) fs.writeFileSync(path.join(flowTestsDir(root), file), body)
  const index: FlowTestsFile = { version: 1, generatedAt: '2026-01-01T00:00:00.000Z', tests: opts.tests }
  fs.writeFileSync(flowTestsIndexPath(root), `${JSON.stringify(index, null, 2)}\n`)
  return root
}

const events = (root: string): string[] => fs.readFileSync(path.join(root, 'events.log'), 'utf-8').trim().split('\n')
const plain = (body: string): string => `import { test, expect } from './flow'\n\n${body}\n`

describe('a run of the stored flow tests', () => {
  it('runs every test with a spec against one product, and sets each beside how it was authored', async () => {
    const root = tree({
      specs: {
        'see-invoices.spec.ts': plain(SEES_HEADING),
        'export-invoices.spec.ts': plain(SEES_EXPORT),
        'heading-fixed.spec.ts': plain(SEES_HEADING),
        'rename-account.seed.ts': `import type { SeedContext } from './flow'\n\nexport async function seed({ unique }: SeedContext) {\n  throw new Error('sign-up refused ' + unique)\n}\n`,
        'rename-account.spec.ts': `import { expect, flowTest } from './flow'\nimport { seed } from './rename-account.seed'\n\nconst test = flowTest(seed)\n\n${SEES_HEADING}\n`,
      },
      tests: [
        record('see-invoices', 'passing'),
        record('export-invoices', 'passing'),
        record('heading-fixed', 'failing'),
        record('rename-account', 'passing', { seed: 'rename-account.seed.ts' }),
        record('pay-invoice', 'blocked'),
      ],
    })
    const indexBefore = fs.readFileSync(flowTestsIndexPath(root), 'utf-8')

    const outcome = await runStoredFlowTests({ repoRoot: root, worldId: 'tc-flow-test-run', branch: 'main', commit: 'abc123' })
    if (outcome.status !== 'ok') throw new Error(`${outcome.status}: ${'reason' in outcome ? outcome.reason : ''}`)
    const { latest } = outcome

    // One product for the whole run: built once, up once, down at the end (and
    // once before up, clearing whatever an earlier run left).
    expect(events(root)).toEqual(['build', 'down', 'up', 'down'])

    const byFlow = new Map((latest.flowTests ?? []).map((t) => [t.flowId, t]))
    expect([...byFlow.keys()].sort()).toEqual(['export-invoices', 'heading-fixed', 'rename-account', 'see-invoices'])
    expect(byFlow.get('see-invoices')).toMatchObject({ authored: 'passing', outcome: 'pass' })
    expect(byFlow.get('export-invoices')).toMatchObject({ authored: 'passing', outcome: 'fail' })
    expect(byFlow.get('heading-fixed')).toMatchObject({ authored: 'failing', outcome: 'pass' })
    expect(byFlow.get('rename-account')).toMatchObject({ authored: 'passing', outcome: 'seed-failed' })

    // The failing test says where it stopped: the step that failed, and the one never reached.
    const exported = byFlow.get('export-invoices')!.run
    expect(exported.steps.map((s) => [s.title, s.outcome])).toEqual([
      ['open the invoices page', 'passed'],
      ['export', 'failed'],
    ])
    expect(exported.error).toContain("getByRole('button', { name: 'Export' })")
    // Its pictures are kept as this run's evidence, in the tree.
    expect(exported.evidencePath).toBe(`.truecourse/guard/evidence/${latest.run.runId}/export-invoices`)
    expect(fs.readdirSync(path.join(root, exported.evidencePath!))).toContain('step-1.png')

    expect(latest.run).toMatchObject({ branch: 'main', commit: 'abc123', recipeFingerprint: 'product-world' })
    expect(latest.summary).toEqual({ total: 4, pass: 2, fail: 1, stale: 0, orphaned: 0, error: 1, blocked: 0 })
    expect(latest.scenarios).toEqual([])
    expect(tallyFlowTestRun(latest.flowTests ?? [])).toEqual({
      run: 4,
      passed: 2,
      failed: 1,
      seedFailed: 1,
      skipped: 0,
      nowFailing: 1,
      nowPassing: 1,
    })

    // What authoring recorded stands exactly as it was.
    expect(fs.readFileSync(flowTestsIndexPath(root), 'utf-8')).toBe(indexBefore)
  }, 180_000)

  it('stops at a build that fails, with what the script printed, and never brings the product up', async () => {
    const root = tree({
      build: `echo build >> events.log\necho "pnpm: command not found" >&2\nexit 127\n`,
      specs: { 'see-invoices.spec.ts': plain(SEES_HEADING) },
      tests: [record('see-invoices', 'passing')],
    })

    const outcome = await runStoredFlowTests({ repoRoot: root, worldId: 'tc-flow-test-run', branch: null, commit: null })

    expect(outcome).toMatchObject({ status: 'world-failed', stage: 'build' })
    expect(outcome.status === 'world-failed' && outcome.reason).toMatch(/world\/build\.sh exited 127:\n[\s\S]*pnpm: command not found/)
    expect(events(root)).toEqual(['build'])
  }, 60_000)

  it('has nothing to run when every flow is blocked', async () => {
    const root = tree({ specs: {}, tests: [record('pay-invoice', 'blocked')] })

    expect(await runStoredFlowTests({ repoRoot: root, worldId: 'tc-flow-test-run', branch: null, commit: null })).toEqual({
      status: 'no-tests',
    })
    expect(fs.existsSync(path.join(root, 'events.log'))).toBe(false)
  })
})
