/**
 * THE NON-CANONICAL ESCAPES in a real browser: a `css` locator and a positional
 * `pick`, resolved by the same executor every web step runs through, on the
 * controls no user-perceivable handle reaches — an icon-only button, two
 * controls sharing one title, identical buttons one per row.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchWebBrowser, type WebBrowserHandle } from '@truecourse/guard-runner'
import type { GuardWebStep } from '@truecourse/shared'
import { executeWebStep } from '../../packages/guard-runner/src/web/executor'

const PAGE = `
  <style>i.bi { display: inline-block; width: 16px; height: 16px }</style>
  <nav aria-label="Sidebar"><button title="More" onclick="say('sidebar more')">More</button></nav>
  <main>
    <button data-action="sort" onclick="say('sorted')"><i class="bi bi-chevron-expand"></i></button>
    <i class="bi bi-three-dots" title="More" onclick="say('page options')"></i>
    <ul>
      <li>Alpha <button onclick="say('deleted Alpha')"><i class="bi bi-trash"></i></button></li>
      <li>Beta <button onclick="say('deleted Beta')"><i class="bi bi-trash"></i></button></li>
    </ul>
    <p id="status">idle</p>
  </main>
  <script>function say(text) { document.getElementById('status').textContent = text }</script>
`

describe('css locators and positional picks', () => {
  let browser: WebBrowserHandle
  let evidenceDir: string
  beforeAll(async () => {
    evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-web-css-'))
    const launched = await launchWebBrowser({ videoDir: evidenceDir })
    if (!launched.ok) throw new Error(launched.reason)
    browser = launched.browser
  }, 60_000)
  afterAll(async () => {
    await browser?.close()
    fs.rmSync(evidenceDir, { recursive: true, force: true })
  })
  beforeEach(async () => {
    await browser.page.setContent(PAGE)
  })
  const execute = (step: GuardWebStep) =>
    executeWebStep({ page: browser.page, baseUrl: 'http://localhost', step, stepIndex: 1, evidenceDir, timeoutMs: 500 })

  it('clicks the one element a css selector names', async () => {
    const result = await execute({ driver: 'web', click: { css: 'main button:has(i.bi-chevron-expand)' }, expect: { text: { contains: 'sorted' } } })
    expect(result.mismatch).toBeUndefined()
  })

  it('scopes a visible handle to a css region, past the control that shares its title', async () => {
    const result = await execute({ driver: 'web', click: { title: 'More', within: { css: 'main' } }, expect: { text: { contains: 'page options' } } })
    expect(result.mismatch).toBeUndefined()
    expect(result.visibleText).not.toContain('sidebar more')
  })

  it('refuses a css selector that matches several elements, as any ambiguous target', async () => {
    const result = await execute({ driver: 'web', click: { css: 'button:has(i.bi-trash)' } })
    expect(result.mismatch?.actual).toContain('2 elements match')
    expect(result.visibleText).toContain('idle')
  })

  it('acts on the match a 1-based pick names', async () => {
    const result = await execute({ driver: 'web', click: { css: 'button:has(i.bi-trash)', pick: 2 }, expect: { text: { contains: 'deleted Beta' } } })
    expect(result.mismatch).toBeUndefined()
  })

  it('fails a pick past the matches as a target nothing matches', async () => {
    const result = await execute({ driver: 'web', click: { css: 'button:has(i.bi-trash)', pick: 3 } })
    expect(result.mismatch?.actual).toContain('nothing on the page matches #3 css “button:has(i.bi-trash)”')
    expect(result.visibleText).toContain('idle')
  })
})
