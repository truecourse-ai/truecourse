import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadScenarios, launchWebBrowser, resolveWebStep, type WebBrowserHandle } from '@truecourse/guard-runner'
import { describeWebExpect, GuardStepWebCheckSchema, GuardWebExpectSchema, GuardWebStepSchema, webStepPatterns, type GuardWebExpect, type GuardWebStep } from '@truecourse/shared'
import { executeWebStep } from '../../packages/guard-runner/src/web/executor'
import { makeTempRepo, rmrf, writeScenarioFile, specBinds } from './helpers.js'

const dialog = { role: 'dialog' as const, name: 'Add expense', exact: true }
const field = { label: 'Description', exact: true }

it('strictly validates negative, cardinality and current-value assertions', () => {
  for (const invalid of [
    { hidden: [] }, { hidden: { ...dialog, pick: 'first' } },
    { count: { target: { ...dialog, pick: 'first' }, equals: 1 } },
    { count: { target: dialog, equals: -1 } }, { count: { target: dialog, equals: 1.5 } },
    { inputValue: { target: field, expected: { browserDate: 'tomorrow' } } },
    { inputValue: { target: field, expected: { browserDate: 'today', equals: '2026-01-01' } } },
    { inputValue: { target: field, expected: {} } },
  ]) expect(GuardWebExpectSchema.safeParse(invalid).success).toBe(false)
  expect(GuardWebExpectSchema.parse({ count: { target: dialog, equals: 0 } }).count?.equals).toBe(0)
})

it('resolves every new locator and matcher token and exposes regexes to validation', () => {
  const target = { label: '${unique}', within: { role: 'dialog' as const, name: '${unique}' } }
  const step = GuardWebStepSchema.parse({ driver: 'web', expect: {
    hidden: [target], count: { target, equals: 0 },
    inputValue: { target, expected: { matches: '${unique}' } },
  } })
  const resolved = resolveWebStep(step, text => text.replaceAll('${unique}', 'expense'))
  expect(JSON.stringify(resolved)).not.toContain('${unique}')
  expect(webStepPatterns(resolved)).toContainEqual({ where: 'expect.inputValue.expected', pattern: 'expense' })
  expect(describeWebExpect(resolved.expect)).toContain('hidden or absent')
  expect(describeWebExpect(resolved.expect)).toContain('0 visible matches')
  expect(describeWebExpect({ inputValue: { target, expected: { browserDate: 'today' } } })).toContain('browser timezone')
})

it('loads new assertions from YAML and rejects invalid input-value regexes before execution', () => {
  const repo = makeTempRepo()
  try {
    const scenario = { id: 'values', title: 'Read current values', binds: specBinds('a/b'), normalize: [], steps: [
      { driver: 'web', expect: { hidden: dialog, count: { target: dialog, equals: 0 }, inputValue: { target: field, expected: { matches: '^Expense' } } } },
    ] }
    writeScenarioFile(repo, 'values.yaml', JSON.stringify(scenario))
    const loaded = loadScenarios(repo)
    expect(loaded.errors).toEqual([])
    expect(loaded.scenarios[0].steps[0]).toMatchObject(scenario.steps[0])
    scenario.steps[0].expect.inputValue.expected.matches = '['
    writeScenarioFile(repo, 'values.yaml', JSON.stringify(scenario))
    const invalid = loadScenarios(repo)
    expect(invalid.scenarios).toEqual([])
    expect(invalid.errors[0].message).toContain('expect.inputValue.expected')
    expect(invalid.errors[0].message).toContain('not a valid regular expression')
  } finally { rmrf(repo) }
})

// This suite deliberately fails when Chromium is unavailable. Skipping it would
// leave the capabilities required by generation unverified.
describe('closure, visible counts and DOM values in Chromium', () => {
  let browser: WebBrowserHandle
  let evidenceDir: string
  beforeAll(async () => {
    evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-web-expect-'))
    const launched = await launchWebBrowser({ videoDir: evidenceDir })
    if (!launched.ok) throw new Error(launched.reason)
    browser = launched.browser
  })
  afterAll(async () => { await browser?.close(); fs.rmSync(evidenceDir, { recursive: true, force: true }) })
  const execute = (step: GuardWebStep) => executeWebStep({
    page: browser.page, baseUrl: 'http://localhost', step, stepIndex: 1, evidenceDir, timeoutMs: 350,
  })
  const check = (assertion: GuardWebExpect) => execute({ driver: 'web', expect: assertion })

  it.each(['this.parentElement.remove()', "this.parentElement.style.display='none'", 'setTimeout(() => this.parentElement.remove(), 120)'])('proves a previously visible dialog closes: %s', async handler => {
    await browser.page.setContent(`<section role="dialog" aria-label="Add expense"><button onclick="${handler}">Cancel</button></section>`)
    expect((await check({ visible: dialog })).mismatch).toBeUndefined()
    const result = await execute({ driver: 'web', click: { role: 'button', name: 'Cancel', within: dialog }, expect: { hidden: dialog } })
    expect(result.mismatch).toBeUndefined()
    expect(result.checks).toMatchObject([{ subject: 'hidden', ok: true, actual: expect.stringContaining('0 visible matches') }])
    expect(GuardStepWebCheckSchema.safeParse(result.checks[0]).success).toBe(true)
  })

  it('fails a broken Cancel handler even though clicking succeeded', async () => {
    await browser.page.setContent('<section role="dialog" aria-label="Add expense"><button>Cancel</button></section>')
    expect((await check({ visible: dialog })).mismatch).toBeUndefined()
    const result = await execute({ driver: 'web', click: { role: 'button', name: 'Cancel', within: dialog }, expect: { hidden: dialog } })
    expect(result.mismatch?.subject).toBe('hidden')
    expect(result.checks[0]).toMatchObject({ ok: false, actual: expect.stringContaining('1 visible matches') })
  })

  it('never treats duplicate visible targets or a hidden first match as absence', async () => {
    await browser.page.setContent('<p style="display:none">Pending expense</p><p>Pending expense</p><p>Pending expense</p>')
    const result = await check({ hidden: { text: 'Pending expense', exact: true } })
    expect(result.mismatch?.actual).toContain('2 visible matches')
    expect((await check({ count: { target: { text: 'Pending expense', exact: true }, equals: 2 } })).mismatch).toBeUndefined()
  })

  it('counts visually present aria-hidden role matches rather than silently ignoring them', async () => {
    await browser.page.setContent('<button aria-hidden="true" aria-label="Cancel">Cancel</button>')
    expect((await check({ hidden: { role: 'button', name: 'Cancel' } })).mismatch).toBeDefined()
  })

  it.each(['', '<section role="dialog" aria-label="Add expense"></section><section role="dialog" aria-label="Add expense"></section>'])('does not turn a missing or ambiguous scope into a successful zero: %s', async html => {
    await browser.page.setContent(html)
    const target = { role: 'button' as const, name: 'Cancel', within: dialog }
    for (const assertion of [{ hidden: target }, { count: { target, equals: 0 } }]) {
      const result = await check(assertion)
      expect(result.mismatch?.subject).toBe('target')
      expect(result.checks[0].ok).toBe(false)
    }
  })

  it('waits for cardinality to change and supports empty results', async () => {
    await browser.page.setContent('<button onclick="setTimeout(() => document.querySelectorAll(\'li\').forEach(node => node.remove()), 120)">Clear</button><ul><li>Expense</li><li style="display:none">Expense</li><li>Expense</li></ul>')
    expect((await check({ count: { target: { text: 'Expense', exact: true }, equals: 2 } })).mismatch).toBeUndefined()
    expect((await execute({ driver: 'web', click: { role: 'button', name: 'Clear' }, expect: { count: { target: { text: 'Expense', exact: true }, equals: 0 } } })).mismatch).toBeUndefined()
  })

  it('reads a changed input property instead of its original value attribute', async () => {
    await browser.page.setContent('<label>Description<input value="Original"></label>')
    await browser.page.getByLabel('Description').fill('Current')
    const result = await check({ inputValue: { target: field, expected: { equals: 'Current' } } })
    expect(result.mismatch).toBeUndefined()
    expect(await browser.page.getByLabel('Description').getAttribute('value')).toBe('Original')
    expect(result.checks[0]).toMatchObject({ subject: 'inputValue', actual: expect.stringContaining('Current'), ok: true })
    expect(GuardStepWebCheckSchema.safeParse(result.checks[0]).success).toBe(true)
  })

  it('waits for async values and reads textarea and select DOM values', async () => {
    await browser.page.setContent('<label for="description">Description</label><textarea id="description">Old</textarea><label>Category<select><option value="travel">Transport</option></select></label><button onclick="setTimeout(() => document.querySelector(\'textarea\').value=\'Updated\', 120)">Update</button>')
    expect((await execute({ driver: 'web', click: { role: 'button', name: 'Update' }, expect: { inputValue: { target: field, expected: { matches: '^Updated$' } } } })).mismatch).toBeUndefined()
    expect((await check({ inputValue: { target: { label: 'Category' }, expected: { equals: 'travel' } } })).mismatch).toBeUndefined()
    expect((await check({ inputValue: { target: { label: 'Category' }, expected: { equals: 'Transport' } } })).mismatch).toBeDefined()
  })

  it.each(['', '<p aria-label="Description">Not an input</p>', '<label>Description<input></label><label>Description<input></label>'])('fails missing, wrong-type and ambiguous input targets: %s', async html => {
    await browser.page.setContent(html)
    expect((await check({ inputValue: { target: field, expected: { equals: '' } } })).mismatch).toBeDefined()
  })

  it.each([
    ['UTC', '2026-09-09T23:59:59Z', '2026-09-09'],
    ['UTC', '2026-09-10T00:00:01Z', '2026-09-10'],
    ['America/Los_Angeles', '2026-09-10T00:00:01Z', '2026-09-09'],
    ['Asia/Tokyo', '2026-09-09T23:59:59Z', '2026-09-10'],
  ])('computes today in browser timezone %s at %s', async (timezoneId, instant, expected) => {
    const context = await browser.page.context().browser()!.newContext({ timezoneId })
    try {
      const page = await context.newPage()
      await page.clock.setFixedTime(new Date(instant))
      await page.setContent(`<label>Expense date<input type="date" value="${expected}"></label>`)
      const step: GuardWebStep = { driver: 'web', expect: { inputValue: { target: { label: 'Expense date' }, expected: { browserDate: 'today' } } } }
      const opts = { page, baseUrl: 'http://localhost', step, stepIndex: 1, evidenceDir, timeoutMs: 200 }
      expect((await executeWebStep(opts)).mismatch).toBeUndefined()
      await page.getByLabel('Expense date').fill('1999-01-01')
      const result = await executeWebStep(opts)
      expect(result.mismatch).toBeDefined()
      expect(result.checks[0].expected).toContain(expected)
      expect(result.checks[0].actual).toContain('1999-01-01')
    } finally { await context.close() }
  })
})
