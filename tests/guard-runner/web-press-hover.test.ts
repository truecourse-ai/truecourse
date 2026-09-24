/**
 * THE PRESS AND HOVER VERBS in a real browser: a search box that submits on
 * Enter, a menu that closes on Escape, and a delete button a row shows only
 * under the pointer — the claims only a key or a pointer states.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isBrowserInstalled, launchWebBrowser, resolveWebStep, type WebBrowserHandle } from '@truecourse/guard-runner'
import { GuardWebStepSchema, describeWebCommand, type GuardWebStep } from '@truecourse/shared'
import { executeWebStep } from '../../packages/guard-runner/src/web/executor'

describe('the press and hover steps', () => {
  it('take only a named key, and read as what they do', () => {
    expect(GuardWebStepSchema.safeParse({ driver: 'web', press: 'Enter', on: { role: 'searchbox', name: 'Search' } }).success).toBe(true)
    expect(GuardWebStepSchema.safeParse({ driver: 'web', press: 'Escape' }).success).toBe(true)
    expect(GuardWebStepSchema.safeParse({ driver: 'web', press: 'F5' }).success).toBe(false)
    expect(describeWebCommand({ driver: 'web', press: 'Enter', on: { role: 'searchbox', name: 'Search' } })).toBe('press Enter on searchbox “Search”')
    expect(describeWebCommand({ driver: 'web', hover: { role: 'row', name: 'Inbox' } })).toBe('hover row “Inbox”')
  })

  it('resolve their locators through the token pass', () => {
    const tok = (text: string) => text.replaceAll('${unique}', 'u1')
    expect(resolveWebStep({ driver: 'web', press: 'Enter', on: { label: 'Search ${unique}' } }, tok)).toMatchObject({ on: { label: 'Search u1' } })
    expect(resolveWebStep({ driver: 'web', hover: { text: 'Row ${unique}' } }, tok)).toMatchObject({ hover: { text: 'Row u1' } })
  })
})

describe.runIf(await isBrowserInstalled())('pressing and hovering in Chromium', () => {
  let browser: WebBrowserHandle
  let evidenceDir: string
  beforeAll(async () => {
    evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-web-press-'))
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
      <style>.row .delete { visibility: hidden } .row:hover .delete { visibility: visible }</style>
      <form onsubmit="event.preventDefault(); document.querySelector('#status').textContent = 'searched: ' + this.q.value">
        <input type="search" name="q" aria-label="Search" value="tags">
      </form>
      <button aria-haspopup="menu" onclick="document.querySelector('#menu').hidden = false">Options</button>
      <div id="menu" role="menu" hidden onkeydown="if (event.key === 'Escape') this.hidden = true" tabindex="-1">
        <button role="menuitem" autofocus>Rename</button>
      </div>
      <div class="row" role="row" aria-label="Inbox"><span>Inbox</span>
        <button class="delete" onclick="document.querySelector('#status').textContent = 'deleted Inbox'">Delete</button>
      </div>
      <p id="status">untouched</p>
    `)
  })
  const execute = (step: GuardWebStep) => executeWebStep({
    page: browser.page, baseUrl: 'http://localhost', step, stepIndex: 1, evidenceDir, timeoutMs: 1_000,
  })

  it('submits a search box on Enter', async () => {
    const result = await execute({ driver: 'web', press: 'Enter', on: { role: 'searchbox', name: 'Search' }, expect: { text: { contains: 'searched: tags' } } })
    expect(result.mismatch).toBeUndefined()
    expect(result.infra).toBeUndefined()
  })

  it('closes an open menu on Escape, pressed on whatever has focus', async () => {
    await execute({ driver: 'web', click: { role: 'button', name: 'Options' } })
    await browser.page.locator('[role=menuitem]').focus()
    const result = await execute({ driver: 'web', press: 'Escape', expect: { hidden: { role: 'menuitem', name: 'Rename' } } })
    expect(result.mismatch).toBeUndefined()
  })

  it('reveals a button shown only on hover, which is then clickable', async () => {
    const hidden = await execute({ driver: 'web', expect: { visible: { role: 'button', name: 'Delete' } } })
    expect(hidden.mismatch).toBeDefined()
    const hovered = await execute({ driver: 'web', hover: { role: 'row', name: 'Inbox' }, expect: { visible: { role: 'button', name: 'Delete' } } })
    expect(hovered.mismatch).toBeUndefined()
    const clicked = await execute({ driver: 'web', click: { role: 'button', name: 'Delete' }, expect: { text: { contains: 'deleted Inbox' } } })
    expect(clicked.mismatch).toBeUndefined()
  })
})
