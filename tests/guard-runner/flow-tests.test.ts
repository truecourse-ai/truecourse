/**
 * Running flow tests: real `@playwright/test` specs in a work tree's tests
 * directory, executed in a real browser against a page served from this
 * process, and read back as one result per flow.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { runFlowTests } from '@truecourse/guard-runner'
import type { ProductWorld } from '@truecourse/shared'
import { flowTestsDir, worldDir, worldStatePath } from '@truecourse/shared/work-tree'

const PAGE = '<html><body><h1>Invoices</h1><p>Signed in as <span data-testid="who">admin@example.com</span></p></body></html>'

let server: http.Server
let root: string
let world: ProductWorld

beforeAll(async () => {
  server = http.createServer((_req, res) => res.setHeader('content-type', 'text/html').end(PAGE))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  world = {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    urls: {},
    accounts: [{ name: 'admin', email: 'admin@example.com' }],
  }
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-flow-tests-'))
  fs.mkdirSync(worldDir(root), { recursive: true })
  fs.mkdirSync(flowTestsDir(root), { recursive: true })
  fs.writeFileSync(worldStatePath(root), JSON.stringify(world))
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  fs.rmSync(root, { recursive: true, force: true })
})

function spec(name: string, body: string): void {
  fs.writeFileSync(
    path.join(flowTestsDir(root), name),
    `import { test, expect } from '@playwright/test'\nimport { account } from './world'\n\n${body}\n`,
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

  it('runs only the specs it was asked for', async () => {
    const run = await runFlowTests(root, { world, tests: [{ flowId: 'see-invoices', file: 'see-invoices.spec.ts' }] })
    if (!run.ok) throw new Error(run.reason)
    expect(run.results.map((r) => [r.flowId, r.outcome])).toEqual([['see-invoices', 'pass']])
  }, 120_000)
})
