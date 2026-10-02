/**
 * The flow-test session's gate: what the engine accepts as a flow's test and
 * seed. Real specs and seeds in a work tree, run by real Playwright against a
 * page served from this process, held against the outcome a session reports.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import type { FlowTestWorld } from '@truecourse/guard-runner'
import type { FlowTestOutcome, GuardFlow } from '@truecourse/shared'
import { flowSeedPath, flowTestPath, flowTestsDir, worldDir, worldStatePath } from '@truecourse/shared/work-tree'
import { flowTestSessionDef } from '../../packages/core/dist/services/product-world/flow-test-session.js'

const FLOW = { id: 'see-invoices', title: 'See invoices' } as GuardFlow
const PASSING: FlowTestOutcome = { status: 'passing', summary: 'The invoices page lists invoices.' }
const FAILING: FlowTestOutcome = {
  status: 'failing',
  summary: 'The invoices page has no export.',
  disagreement: { documented: 'billing.md: the page offers an export', observed: 'no export control' },
}
const BLOCKED: FlowTestOutcome = { status: 'blocked', summary: 'Needs a payment provider.', blockedBy: 'no Stripe account' }

const SPEC_HEAD = `import { expect, flowTest } from './flow'
import { seed } from './see-invoices.seed'

const test = flowTest(seed)
`
const SEES_HEADING = `test('the invoices page is there', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible({ timeout: 1000 })
})
`
const SEES_EXPORT = `test('the invoices page offers an export', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Export' })).toBeVisible({ timeout: 1000 })
})
`
const seedOf = (body: string): string =>
  `import type { SeedContext } from './flow'\n\nexport async function seed({ unique }: SeedContext) {\n${body}\n}\n`

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

function judge(outcome: FlowTestOutcome): Promise<string | undefined> {
  const { def } = flowTestSessionDef({ repoRoot: root, flow: FLOW, steps: [], world })
  return Promise.resolve(def.validateOutcome?.(outcome, { wrappingUp: false }))
}

describe('the flow-test session gate', () => {
  it('accepts a passing test that ran on its own seed', async () => {
    write({ spec: SPEC_HEAD + SEES_HEADING, seed: seedOf('  return { owner: `owner-${unique}` }') })
    expect(await judge(PASSING)).toBeUndefined()
  }, 120_000)

  it('accepts a failing test only when the test fails, never when its seed does', async () => {
    write({ spec: SPEC_HEAD + SEES_EXPORT, seed: seedOf('  return { owner: `owner-${unique}` }') })
    expect(await judge(FAILING)).toBeUndefined()

    write({ seed: seedOf('  throw new Error(`sign-up for owner-${unique} answered 500`)') })
    const refusal = await judge(FAILING)
    expect(refusal).toContain('the seed')
    expect(refusal).toContain('answered 500')
    expect(refusal).toContain('not a finding')
  }, 120_000)

  it('refuses a seed that names things without `unique`, before running anything', async () => {
    write({
      spec: SPEC_HEAD + SEES_HEADING,
      seed: `import type { SeedContext } from './flow'\n\nexport async function seed(_: SeedContext) {\n  return { owner: 'owner@example.com' }\n}\n`,
    })
    expect(await judge(PASSING)).toContain('never uses `unique`')
  })

  it('refuses a seed its spec does not run', async () => {
    write({
      spec: `import { test, expect } from './flow'\n\n${SEES_HEADING}`,
      seed: seedOf('  return { owner: `owner-${unique}` }'),
    })
    expect(await judge(PASSING)).toContain('the spec does not run it')
  })

  it('holds a blocked flow to leaving neither spec nor seed', async () => {
    write({ seed: seedOf('  return { owner: `owner-${unique}` }') })
    expect(await judge(BLOCKED)).toContain('see-invoices.seed.ts')

    fs.rmSync(flowSeedPath(root, FLOW.id))
    expect(await judge(BLOCKED)).toBeUndefined()
  })
})
