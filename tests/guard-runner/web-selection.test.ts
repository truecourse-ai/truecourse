import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isBrowserInstalled, launchWebBrowser, resolveWebStep, type WebBrowserHandle } from '@truecourse/guard-runner'
import { GuardWebStepSchema, type GuardWebStep } from '@truecourse/shared'
import { executeWebStep } from '../../packages/guard-runner/src/web/executor'

const within = { role: 'dialog' as const, name: 'Edit ${unique}', exact: true }

it('resolves option labels and container names, including assertions and captures', () => {
  const step = GuardWebStepSchema.parse({
    driver: 'web', select: { role: 'combobox', name: 'Category ${unique}', within }, option: 'Food ${unique}',
    expect: { visible: { role: 'combobox', name: 'Category ${unique}', within } },
    capture: { category: { from: { label: 'Category ${unique}', within }, get: { attribute: 'value' } } },
  })
  const resolved = resolveWebStep(step, text => text.replaceAll('${unique}', 'expense'))
  expect(JSON.stringify(resolved)).not.toContain('${unique}')
  expect(resolved).toMatchObject({ option: 'Food expense', select: { within: { name: 'Edit expense' } } })
})

// No application process needed: exercise real DOM controls and events in Chromium.
describe.runIf(await isBrowserInstalled())('native selection and dialog-scoped actions in Chromium', () => {
  let browser: WebBrowserHandle
  let evidenceDir: string
  beforeAll(async () => {
    evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-web-select-'))
    const launched = await launchWebBrowser({ videoDir: evidenceDir })
    if (!launched.ok) throw new Error(launched.reason)
    browser = launched.browser
  })
  afterAll(async () => {
    await browser?.close()
    fs.rmSync(evidenceDir, { recursive: true, force: true })
  })
  beforeEach(async () => {
    await browser.page.setContent(`
      <button onclick="document.querySelector('#status').textContent='wrong opener'">Delete expense</button>
      <label>Category<select><option>Outside</option><option>Food &amp; drink</option></select></label>
      <section role="dialog" aria-label="Edit expense">
        <label>Category<select onchange="document.querySelector('#status').textContent='category: '+this.value">
          <option value="travel">Travel</option><option value="food">Food &amp; drink</option>
        </select></label>
        <button onclick="document.querySelector('#status').textContent='deleted'">Delete expense</button>
      </section>
      <p id="status">untouched</p>
    `)
  })
  const execute = (step: GuardWebStep) => executeWebStep({
    page: browser.page, baseUrl: 'http://localhost', step, stepIndex: 1, evidenceDir, timeoutMs: 500,
  })
  const scope = { role: 'dialog' as const, name: 'Edit expense', exact: true }

  it('chooses a native option by visible label and fires the app change handler', async () => {
    const result = await execute({ driver: 'web', select: { role: 'combobox', name: 'Category', within: scope }, option: 'Food & drink', expect: { text: { contains: 'category: food' } } })
    expect(result.infra).toBeUndefined()
    expect(result.mismatch).toBeUndefined()
    expect(result.checks.every(check => check.ok)).toBe(true)
  })
  it('clicks the confirmation inside the named dialog without hitting its duplicate opener', async () => {
    const result = await execute({ driver: 'web', click: { role: 'button', name: 'Delete expense', exact: true, within: scope }, expect: { text: { contains: 'deleted' } } })
    expect(result.mismatch).toBeUndefined()
    expect(result.visibleText).not.toContain('wrong opener')
  })
  it('still rejects an unscoped ambiguous target', async () => {
    const result = await execute({ driver: 'web', click: { role: 'button', name: 'Delete expense', exact: true } })
    expect(result.mismatch?.actual).toContain('2 elements match')
    expect(result.visibleText).toContain('untouched')
  })
  it('does not choose the first of several matching containers', async () => {
    await browser.page.setContent('<section role="dialog" aria-label="Edit expense"><button>Delete expense</button></section><section role="dialog" aria-label="Edit expense"></section>')
    const result = await execute({ driver: 'web', click: { role: 'button', name: 'Delete expense', within: scope } })
    expect(result.mismatch?.actual).toContain('2 elements match dialog')
    const assertion = await execute({ driver: 'web', expect: { visible: { role: 'button', name: 'Delete expense', within: scope } } })
    expect(assertion.mismatch?.actual).toContain('2 elements match dialog')
  })
  it('reports a missing option instead of succeeding without changing the selection', async () => {
    const result = await execute({ driver: 'web', select: { role: 'combobox', name: 'Category', within: scope }, option: 'Missing category' })
    expect(result.mismatch).toBeDefined()
    expect(result.visibleText).toContain('untouched')
  })
  it('does not treat an editable combobox as a native select', async () => {
    await browser.page.setContent('<input role="combobox" aria-label="Category"><p>untouched</p>')
    const selected = await execute({ driver: 'web', select: { role: 'combobox', name: 'Category' }, option: 'Food' })
    expect(selected.mismatch).toBeDefined()
    const filled = await execute({ driver: 'web', fill: { role: 'combobox', name: 'Category' }, value: 'Food' })
    expect(filled.mismatch).toBeUndefined()
    expect(await browser.page.getByRole('combobox').inputValue()).toBe('Food')
  })
})
