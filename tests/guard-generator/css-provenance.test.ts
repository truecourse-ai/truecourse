/**
 * A scenario's `css` locators come from the interface catalog, never from the
 * author: every locator carrying `css` — a click's target, an expectation's
 * target, a `within` scope — must equal the locator of a catalog step the live
 * proof held, or the draft is refused before it runs.
 */

import { describe, expect, it } from 'vitest'
import type { Interface } from '../../packages/shared/src/index'
import { unprovenCssLocatorDefect } from '../../packages/guard-generator/src/validate'

const catalog: Interface[] = [
  {
    id: 'web/sort-links',
    type: 'web',
    title: 'Sort the links',
    entry: { method: 'GET', path: '/links' },
    fingerprint: 'sha256:sort',
    steps: [
      { kind: 'activate', target: { css: 'main button:has(i.bi-chevron-expand)' }, why: 'icon-only sort button' },
      { kind: 'activate', target: { title: 'More', pick: 2 }, within: { css: 'main' }, why: 'the page icon shares its title' },
      { kind: 'activate', target: { role: 'button', name: 'Save' } },
    ],
  },
]

describe('a css locator in a generated scenario', () => {
  it('passes when it is a catalog step’s locator, whatever order its keys are written in', () => {
    const steps = [
      { driver: 'web', click: { css: 'main button:has(i.bi-chevron-expand)' } },
      { driver: 'web', click: { within: { css: 'main' }, pick: 2, title: 'More' } },
      { driver: 'web', click: { role: 'button', name: 'Save' }, expect: { visible: { css: 'main button:has(i.bi-chevron-expand)' } } },
      { driver: 'web', navigate: '/links', expect: { text: { contains: 'Links' }, within: { css: 'main' } } },
    ]
    expect(unprovenCssLocatorDefect(steps, catalog)).toBeNull()
  })

  it('is refused when the catalog never proved it — as a target, an expectation or a scope', () => {
    const refused = [
      { driver: 'web', click: { css: 'main button' } },
      { driver: 'web', click: { css: 'main button:has(i.bi-chevron-expand)', pick: 1 } },
      { driver: 'web', click: { title: 'More', within: { css: 'main' } } },
      { driver: 'web', navigate: '/links', expect: { visible: [{ role: 'heading', name: 'Links' }, { css: 'nav i.bi-list' }] } },
      { driver: 'web', navigate: '/links', expect: { text: { contains: 'Links' }, within: { css: 'aside' } } },
    ]
    for (const step of refused) {
      const defect = unprovenCssLocatorDefect([{ driver: 'web', navigate: '/links' }, step], catalog)
      expect(defect, JSON.stringify(step)).toContain('step 2 addresses')
      expect(defect).toContain('no interface step in the catalog carries')
    }
  })

  it('passes a css locator copied from a readable the catalog proved, as an element or a scope', () => {
    const places = [
      {
        id: 'links',
        kind: 'screen' as const,
        title: 'Links',
        address: '/links',
        readables: {
          markers: [{ marker: 'Delete link', within: { css: 'div:has(> button[data-testid="close"])' }, why: 'the modal has no dialog role' }],
          elements: [{ element: { css: 'main .cards' }, why: 'the card list has no list role' }],
        },
      },
    ]
    const steps = [
      { driver: 'web', navigate: '/links', expect: { visible: { css: 'main .cards' } } },
      { driver: 'web', click: { role: 'button', name: 'Cancel' }, expect: { text: { contains: 'Delete link' }, within: { css: 'div:has(> button[data-testid="close"])' } } },
    ]
    expect(unprovenCssLocatorDefect(steps, [], places)).toBeNull()
    expect(unprovenCssLocatorDefect(steps, [])).toContain('step 1 addresses')
  })

  it('leaves canonical locators and other drivers alone', () => {
    const steps = [
      { driver: 'web', click: { title: 'More', within: { role: 'main', name: 'Links' } } },
      { driver: 'api', request: { method: 'GET', path: '/api/links' } },
    ]
    expect(unprovenCssLocatorDefect(steps, [])).toBeNull()
  })
})
