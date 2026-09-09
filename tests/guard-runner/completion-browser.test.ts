import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchWebBrowser, type WebBrowserHandle } from '@truecourse/guard-runner'
import { GuardWebStepSchema, type GuardWebStep } from '@truecourse/shared'
import { executeWebStep } from '../../packages/guard-runner/src/web/executor'
import { expenseFixture, type ExpenseDefect } from '../fixtures/guard-completion/expense-fixture'

const dialog = { role: 'dialog' as const, name: 'Add expense', exact: true }
const table = { role: 'table' as const, name: 'Expenses', exact: true }
const click = (name: string): GuardWebStep => ({ driver: 'web', click: { role: 'button', name, exact: true } })
const fill = (label: string, value: string): GuardWebStep => ({ driver: 'web', fill: { label, within: dialog, exact: true }, value })
const open: GuardWebStep = { ...click('Add expense'), expect: { visible: dialog } }
const unsavedDraft = { role: 'link' as const, name: 'Uncommitted', exact: true, within: table }
const cancel: GuardWebStep[] = [open, fill('Description', 'Uncommitted'), fill('Amount', '7.25'),
  fill('Expense date', '2101-01-01'),
  { driver: 'web', select: { label: 'Category', exact: true, within: dialog }, option: 'Transport' },
  fill('Notes', 'A valid draft that must never be saved'), {

  driver: 'web', click: { role: 'button', name: 'Cancel', within: dialog, exact: true },
  expect: { hidden: dialog },
}, { driver: 'web', expect: { hidden: unsavedDraft } }, {
  driver: 'web', expect: { text: { contains: 'Overall total: $41.75' }, count: { target: { role: 'link', name: 'View expense:', within: table }, equals: 3 } },
}]

const save: GuardWebStep[] = [
  { driver: 'web', select: { label: 'Category filter' }, option: 'Transport' },
  { ...click('Next page'), expect: { text: { contains: 'Page 2' }, visible: { role: 'link', name: 'Historical', exact: true } } },
  open, fill('Description', 'New expense'), fill('Amount', '7.25'), fill('Expense date', '2101-01-01'),
  { driver: 'web', click: { role: 'button', name: 'Save expense', within: dialog }, expect: { hidden: dialog } },
  { driver: 'web', expect: { within: { role: 'status', name: 'Notifications' }, text: { equals: 'Expense added.' } } },
  { driver: 'web', expect: { text: { contains: 'Overall total: $49.00' } } },
  { driver: 'web', expect: { text: { contains: 'Page 1' }, visible: { role: 'link', name: 'New expense', exact: true } } },
  { driver: 'web', expect: { inputValue: { target: { label: 'Category filter' }, expected: { equals: 'travel' } } } },
]

function stepsFor(defect: ExpenseDefect): GuardWebStep[] {
  if (defect === 'cancel' || defect === 'cancel-submits') return cancel
  if (defect === 'date-default') return [open, { driver: 'web', expect: { inputValue: { target: { label: 'Expense date', within: dialog }, expected: { browserDate: 'today' } } } }]
  if (defect === 'category-default') return [open, { driver: 'web', expect: { inputValue: { target: { label: 'Category', exact: true, within: dialog }, expected: { equals: 'travel' } } } }]
  if (defect === 'total') return [{ driver: 'web', expect: { text: { contains: 'Overall total: $41.75' } } }]
  if (defect === 'primary-order' || defect === 'tie-order') return [{ driver: 'web', expect: { within: table, text: { matches: '^Recent[\\s\\S]*Tie first[\\s\\S]*Tie second' } } }]
  if (defect === 'details') return [
    { driver: 'web', click: { role: 'link', name: 'Recent', exact: true }, expect: { text: { contains: 'Description: Recent | Amount: $5.00 | Date: 2100-01-01 | Category: Transport | Notes: Train travel' } } },
    click('Back to expenses'),
    { driver: 'web', click: { role: 'link', name: 'View expense: Tie first', exact: true }, expect: { text: { contains: 'Description: Tie first | Amount: $20.50 | Date: 2099-12-31 | Category: Transport | Notes: Taxi' } } },
  ]
  if (defect === 'empty-notes') return [{ driver: 'web', click: { role: 'link', name: 'View expense: Tie second', exact: true }, expect: { text: { contains: 'Notes: No notes added.' } } }]
  return save
}

// The regression must execute with Chromium. No app server or external database.
describe('expense obligations reject deliberately broken behavior', () => {
  let browser: WebBrowserHandle
  let evidenceDir: string
  beforeAll(async () => {
    evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-completion-browser-'))
    const launched = await launchWebBrowser({ videoDir: evidenceDir })
    if (!launched.ok) throw new Error(launched.reason)
    browser = launched.browser
  })
  afterAll(async () => { await browser?.close(); fs.rmSync(evidenceDir, { recursive: true, force: true }) })
  async function run(steps: GuardWebStep[]) {
    for (const [index, step] of steps.entries()) {
      const result = await executeWebStep({ page: browser.page, baseUrl: 'http://localhost', step: GuardWebStepSchema.parse(step), stepIndex: index + 1, evidenceDir, timeoutMs: 300 })
      expect(result.infra).toBeUndefined()
      if (result.mismatch) return result.mismatch
    }
    return undefined
  }
  const defects: ExpenseDefect[] = ['cancel', 'cancel-submits', 'date-default', 'category-default', 'total', 'save-closure', 'announcement', 'pagination', 'filters', 'primary-order', 'tie-order', 'details', 'empty-notes']
  it.each(defects)('passes the complete %s assertion and fails its broken variant', async defect => {
    await browser.page.setContent(expenseFixture())
    expect(await run(stepsFor(defect))).toBeUndefined()
    await browser.page.setContent(expenseFixture(defect))
    const failure = await run(stepsFor(defect))
    const expectedSubject = ['cancel', 'cancel-submits', 'save-closure'].includes(defect) ? 'hidden'
      : ['date-default', 'category-default', 'filters'].includes(defect) ? 'inputValue' : 'text'
    expect(failure?.subject).toBe(expectedSubject)
    expect(browser.pageErrors()).toEqual([])
  })
  it('exposes why a blank required amount cannot prove Cancel does not submit', async () => {
    await browser.page.setContent(expenseFixture('cancel-submits'))
    const invalidDraft = cancel.filter(step => !('fill' in step && 'label' in step.fill && step.fill.label === 'Amount'))
    // The submit bug is masked: native validation prevents the save, and the
    // broken Cancel handler still hides the dialog. Absence alone passes.
    expect(await run(invalidDraft)).toBeUndefined()
    await browser.page.setContent(expenseFixture('cancel-submits'))
    const actionIndex = cancel.findIndex(step => 'click' in step && 'role' in step.click && step.click.name === 'Cancel')
    expect(await run(cancel.slice(0, actionIndex))).toBeUndefined()
    expect(await browser.page.getByRole('dialog', { name: 'Add expense', exact: true }).evaluate(form => (form as HTMLFormElement).checkValidity())).toBe(true)
    expect(await run(cancel.slice(actionIndex))).toMatchObject({ subject: 'hidden' })
    expect(await browser.page.getByRole('link', { name: 'Uncommitted', exact: true }).isVisible()).toBe(true)
    expect(await browser.page.getByRole('dialog', { name: 'Add expense', exact: true }).isVisible()).toBe(false)
    expect(browser.pageErrors()).toEqual([])
  })
  it('asserts a controlled empty ledger and zero total, rejecting a wrong total', async () => {
    const steps: GuardWebStep[] = [{ driver: 'web', expect: { text: { contains: 'Overall total: $0.00' }, count: { target: { role: 'link', name: 'View expense:', within: table }, equals: 0 } } }]
    await browser.page.setContent(expenseFixture(undefined, true))
    expect(await run(steps)).toBeUndefined()
    await browser.page.setContent(expenseFixture('total', true))
    expect(await run(steps)).toBeDefined()
  })
})
