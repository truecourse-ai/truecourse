/**
 * Running flow tests: real `@playwright/test` specs in a work tree's tests
 * directory, executed in a real browser against a page served from this
 * process, and read back as one result per flow. A spec's seed runs with it,
 * and a seed that does not hold is told apart from a test that fails.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { runFlowTests, type FlowTestWorld } from '@truecourse/guard-runner'
import { flowTestsDir, worldDir, worldStatePath } from '@truecourse/shared/work-tree'

const PAGE = '<html><body><h1>Invoices</h1><p>Signed in as <span data-testid="who">admin@example.com</span></p></body></html>'

/** The "product": one page, and a sign-up that hands back the account it made. */
function product(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (req.method === 'POST' && req.url === '/api/users') {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => res.setHeader('content-type', 'application/json').end(JSON.stringify({ id: 7, ...JSON.parse(body) })))
    return
  }
  res.setHeader('content-type', 'text/html').end(PAGE)
}

let server: http.Server
let root: string
let world: FlowTestWorld

beforeAll(async () => {
  server = http.createServer(product)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  world = {
    id: 'tc-flow-tests',
    world: {
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      urls: {},
      accounts: [{ name: 'admin', email: 'admin@example.com' }],
    },
  }
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-flow-tests-'))
  fs.mkdirSync(worldDir(root), { recursive: true })
  fs.mkdirSync(flowTestsDir(root), { recursive: true })
  fs.writeFileSync(worldStatePath(root), JSON.stringify(world.world))
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  fs.rmSync(root, { recursive: true, force: true })
})

function spec(name: string, body: string): void {
  fs.writeFileSync(
    path.join(flowTestsDir(root), name),
    `import { test, expect } from '@playwright/test'\nimport { account } from './flow'\n\n${body}\n`,
  )
}

/** A flow with a seed: `<flow>.seed.ts` and the spec that is bound to it. */
function seeded(flow: string, seedBody: string, testBody: string): void {
  fs.writeFileSync(
    path.join(flowTestsDir(root), `${flow}.seed.ts`),
    `import type { SeedContext } from './flow'\n\nexport async function seed({ world, request, unique }: SeedContext) {\n${seedBody}\n}\n`,
  )
  fs.writeFileSync(
    path.join(flowTestsDir(root), `${flow}.spec.ts`),
    `import { expect } from '@playwright/test'\nimport { flowTest } from './flow'\nimport { seed } from './${flow}.seed'\n\nconst test = flowTest(seed)\n\n${testBody}\n`,
  )
}

describe('running flow tests', () => {
  it('runs each spec against the world and reports one result per flow', async () => {
    spec(
      'see-invoices.spec.ts',
      `test('the invoices page names the signed-in account', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible()
  await expect(page.getByTestId('who')).toHaveText(account('admin').email!)
})`,
    )
    spec(
      'export-invoices.spec.ts',
      `test('the invoices page offers an export', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Export' })).toBeVisible({ timeout: 1000 })
})`,
    )
    spec('does-not-compile.spec.ts', `test('broken', async ({ page }) => { await page.goto('/' `)

    const run = await runFlowTests(root, {
      world,
      tests: [
        { flowId: 'see-invoices', file: 'see-invoices.spec.ts' },
        { flowId: 'export-invoices', file: 'export-invoices.spec.ts' },
        { flowId: 'does-not-compile', file: 'does-not-compile.spec.ts' },
      ],
    })
    if (!run.ok) throw new Error(run.reason)
    const [passing, failing, broken] = run.results

    expect(passing).toMatchObject({ flowId: 'see-invoices', file: 'see-invoices.spec.ts', outcome: 'pass' })
    expect(passing.error).toBeUndefined()
    // What a run records sits in the tree, addressed relative to it.
    const trace = passing.attachments.find((a) => a.name === 'trace')
    expect(trace?.path.startsWith('.truecourse/scenarios/tests/results/')).toBe(true)
    expect(fs.existsSync(path.join(root, trace!.path))).toBe(true)

    expect(failing).toMatchObject({ flowId: 'export-invoices', outcome: 'fail' })
    expect(failing.error).toContain("getByRole('button', { name: 'Export' })")

    expect(broken).toMatchObject({ flowId: 'does-not-compile', outcome: 'fail', durationMs: 0 })
    expect(broken.error).toContain('does-not-compile.spec.ts')
  }, 120_000)

  it('runs a spec on what its own seed made', async () => {
    seeded(
      'rename-account',
      `  const email = \`owner-\${unique}@example.com\`
  const response = await request.post('/api/users', { data: { email } })
  if (!response.ok()) throw new Error(\`sign-up answered \${response.status()}\`)
  return { owner: (await response.json()) as { id: number; email: string }, worldId: process.env.TC_WORLD_ID }`,
      `test('the seeded owner exists', async ({ seeded }) => {
  expect(seeded.owner.id).toBe(7)
  expect(seeded.worldId).toBe('tc-flow-tests')
  expect(seeded.owner.email).toMatch(/^owner-[a-z0-9]+@example\\.com$/)
})`,
    )
    const run = await runFlowTests(root, { world, tests: [{ flowId: 'rename-account', file: 'rename-account.spec.ts' }] })
    if (!run.ok) throw new Error(run.reason)
    expect(run.results[0].error).toBeUndefined()
    expect(run.results[0]).toMatchObject({ flowId: 'rename-account', outcome: 'pass' })
  }, 120_000)

  it('reports a seed that does not hold apart from a test that fails', async () => {
    seeded(
      'seed-throws',
      `  const response = await request.post('/api/teams', { data: { name: \`team-\${unique}\` } })
  throw new Error(\`creating the team answered \${response.status()} with a page, not a team\`)`,
      `test('never starts', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible({ timeout: 1000 })
})`,
    )
    seeded(
      'test-fails',
      `  return { name: \`team-\${unique}\` }`,
      `test('the seeded team is listed', async ({ page, seeded }) => {
  await page.goto('/')
  await expect(page.getByText(seeded.name)).toBeVisible({ timeout: 1000 })
})`,
    )
    const run = await runFlowTests(root, {
      world,
      tests: [
        { flowId: 'seed-throws', file: 'seed-throws.spec.ts' },
        { flowId: 'test-fails', file: 'test-fails.spec.ts' },
      ],
    })
    if (!run.ok) throw new Error(run.reason)
    const [seedThrows, testFails] = run.results
    expect(seedThrows).toMatchObject({ flowId: 'seed-throws', outcome: 'seed-failed' })
    expect(seedThrows.error).toContain('creating the team answered 200 with a page, not a team')
    expect(testFails).toMatchObject({ flowId: 'test-fails', outcome: 'fail' })
  }, 120_000)

  it('runs only the specs it was asked for', async () => {
    const run = await runFlowTests(root, { world, tests: [{ flowId: 'see-invoices', file: 'see-invoices.spec.ts' }] })
    if (!run.ok) throw new Error(run.reason)
    expect(run.results.map((r) => [r.flowId, r.outcome])).toEqual([['see-invoices', 'pass']])
  }, 120_000)
})
