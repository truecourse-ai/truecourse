/**
 * THE LIVE PROOF in `check_draft`: a step whose locator carries `css`, or
 * declares a `pick`, is resolved on the running app before the draft keeps it.
 * The observer is a FAKE that answers each probe from a script — what is under
 * test is which steps are proven, where the proof opens and what it replays, and
 * which readings are refused.
 */

import { describe, it, expect } from 'vitest'
import type { InterfacesFile } from '../../packages/shared/src/index'
import { buildAuthorTools } from '../../packages/core/src/services/interface-author/tools'
import type { LiveScreenObserver } from '../../packages/core/src/services/interface-author/live-screen'
import type { LocatorProbeRequest, LocatorReading } from '@truecourse/guard-runner'

const DERIVED: InterfacesFile = {
  version: 2,
  generatedAt: '2026-09-23T00:00:00.000Z',
  recipeFingerprint: 'sha256:recipe',
  interfaces: [],
  resources: {
    web: [
      { id: 'tags-id', kind: 'screen', title: '/tags/{id}', address: '/tags/{id}' },
      { id: 'links', kind: 'screen', title: '/links', address: '/links' },
    ],
  },
  source: { web: 'tree' },
}

const toolContext = { signal: new AbortController().signal } as never

/** An observer whose probes answer with `reading`, remembering every request. */
function probingObserver(reading: LocatorReading): { observer: LiveScreenObserver; probes: LocatorProbeRequest[] } {
  const probes: LocatorProbeRequest[] = []
  return {
    probes,
    observer: {
      async observe() {
        return { ok: false, reason: 'not used' }
      },
      async probe(request) {
        probes.push(request)
        return { ok: true, reading }
      },
      async close() {},
    },
  }
}

function checkDraft(observer?: LiveScreenObserver) {
  const tools = buildAuthorTools({
    repoRoot: '/nowhere',
    derived: DERIVED,
    authored: null,
    replaceable: new Set(),
    ...(observer ? { live: { observer } } : {}),
  })
  const tool = tools.find((t) => t.name === 'check_draft')!
  return (args: unknown) => tool.execute(args, toolContext)
}

const sortStep = {
  kind: 'activate' as const,
  target: { css: 'main button:has(i.bi-chevron-expand)' },
  why: 'icon-only button, no aria-label; SortDropdown renders <i class=bi-chevron-expand>',
}

function linksTask(steps: unknown[]) {
  return { id: 'web/sort-links', type: 'web', title: 'Sort the links', entry: { method: 'GET', path: '/links' }, at: 'links', steps }
}

describe('a css locator', () => {
  it('is refused when the run has no live screen to prove it on', async () => {
    const result = await checkDraft()({ interfaces: [linksTask([sortStep])] })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('no live screen to prove it on')
  })

  it('is refused without a `why`', async () => {
    const { observer } = probingObserver({ matches: 1, visible: true })
    const result = await checkDraft(observer)({ interfaces: [linksTask([{ ...sortStep, why: undefined }])] })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('must say `why`')
  })

  it('is refused when it matches nothing, or more than one element', async () => {
    for (const [matches, words] of [[0, 'matches nothing'], [2, 'matches 2 elements']] as const) {
      const { observer } = probingObserver({ matches, visible: matches === 1 })
      const result = await checkDraft(observer)({ interfaces: [linksTask([sortStep])] })
      expect(result.isError).toBe(true)
      expect(result.content).toContain(words)
    }
  })

  it('is refused when its scope does not resolve to exactly one element', async () => {
    const { observer } = probingObserver({ scopeMatches: 2, matches: 1, visible: true })
    const scoped = { kind: 'activate', target: { title: 'More' }, within: { css: 'section' }, why: 'two controls share the title' }
    const result = await checkDraft(observer)({ interfaces: [linksTask([scoped])] })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('`within` that matches 2 elements')
  })

  it('is accepted when it resolves to exactly one visible element on the task’s address', async () => {
    const { observer, probes } = probingObserver({ matches: 1, visible: true })
    const result = await checkDraft(observer)({ interfaces: [linksTask([sortStep])] })
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('Accepted and kept')
    expect(probes).toEqual([{ path: '/links', activate: [], locator: sortStep.target }])
  })
})

describe('a declared position', () => {
  const trash = { kind: 'activate' as const, target: { css: 'main button:has(i.bi-trash)', pick: 3 }, why: 'icon-only delete button per row' }

  it('is refused past the number of elements it matches', async () => {
    const { observer } = probingObserver({ matches: 2, visible: false })
    const result = await checkDraft(observer)({ interfaces: [linksTask([trash])] })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('`pick: 3` past the 2 element(s)')
  })

  it('is proven on a canonical locator too, and passes unproven only with no live screen', async () => {
    const picked = { kind: 'activate' as const, target: { title: 'More', pick: 2 } }
    const { observer, probes } = probingObserver({ matches: 2, visible: true })
    expect((await checkDraft(observer)({ interfaces: [linksTask([picked])] })).isError).toBeUndefined()
    expect(probes).toHaveLength(1)
    expect((await checkDraft()({ interfaces: [linksTask([picked])] })).isError).toBeUndefined()
  })
})

describe('where a proof opens', () => {
  const tagTask = {
    id: 'web/rename-tag',
    type: 'web',
    title: 'Rename a tag',
    entry: { method: 'GET', path: '/tags/{id}' },
    at: 'tags-id',
    steps: [
      { kind: 'activate', target: { title: 'More' }, within: { css: 'main' }, why: 'the page icon shares its title with the sidebar button' },
      { kind: 'activate', target: { role: 'menuitem', name: 'Rename' } },
      { kind: 'input', target: { role: 'textbox', name: 'Name' } },
      { kind: 'activate', target: { css: 'button:has(i.bi-check2)' }, why: 'icon-only confirm button' },
    ],
  }

  it('asks for a filled address when the entry carries a slot', async () => {
    const { observer, probes } = probingObserver({ scopeMatches: 1, matches: 1, visible: true })
    const result = await checkDraft(observer)({ interfaces: [tagTask] })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('carries a slot')
    expect(probes).toEqual([])
  })

  it('opens the filled address and replays the task’s clicks before the step', async () => {
    const { observer, probes } = probingObserver({ scopeMatches: 1, matches: 1, visible: true })
    const result = await checkDraft(observer)({ interfaces: [tagTask], proof: { 'web/rename-tag': { path: '/tags/3' } } })
    expect(result.isError).toBeUndefined()
    expect(probes).toEqual([
      { path: '/tags/3', activate: [], locator: { title: 'More', within: { css: 'main' } } },
      {
        path: '/tags/3',
        activate: [{ title: 'More', within: { css: 'main' } }, { role: 'menuitem', name: 'Rename' }],
        locator: { css: 'button:has(i.bi-check2)' },
      },
    ])
  })
})
