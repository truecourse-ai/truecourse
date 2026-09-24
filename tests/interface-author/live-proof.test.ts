/**
 * THE LIVE PROOF in `check_draft`: a step whose locator carries `css`, or
 * declares a `pick`, is resolved on the running app before the draft keeps it.
 * The observer is a FAKE that answers each probe from a script — what is under
 * test is which steps are proven, where the proof opens, what it walks, and
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

/** An observer whose probes answer `reading` for every locator they resolve, remembering every request. */
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
        return { ok: true, readings: request.steps.filter((step) => 'resolve' in step).map(() => reading) }
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
    expect(probes).toEqual([{ path: '/links', steps: [{ resolve: sortStep.target }] }])
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
      { kind: 'activate', target: { css: 'button:has(i.bi-pencil)' }, why: 'icon-only edit button' },
    ],
  }
  const scoped = { title: 'More', within: { css: 'main' } }
  const edit = { css: 'button:has(i.bi-pencil)' }

  it('asks for a filled address when the entry carries a slot', async () => {
    const { observer, probes } = probingObserver({ scopeMatches: 1, matches: 1, visible: true })
    const result = await checkDraft(observer)({ interfaces: [tagTask] })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('carries a slot')
    expect(probes).toEqual([])
  })

  it('refuses a proof path that is not a filling of the task’s entry', async () => {
    const { observer, probes } = probingObserver({ scopeMatches: 1, matches: 1, visible: true })
    for (const path of ['/unrelated', '/tags', '/tags/3/edit']) {
      const result = await checkDraft(observer)({ interfaces: [tagTask], proof: { 'web/rename-tag': { path } } })
      expect(result.isError).toBe(true)
      expect(result.content).toContain(`the proof path \`${path}\` is not the task's entry`)
    }
    expect(probes).toEqual([])
  })

  it('replays a click-only task that leaves the world as it was, on one page, reading each step as it passes', async () => {
    const { observer, probes } = probingObserver({ scopeMatches: 1, matches: 1, visible: true })
    const result = await checkDraft(observer)({ interfaces: [tagTask], proof: { 'web/rename-tag': { path: '/tags/3?tab=all' } } })
    expect(result.isError).toBeUndefined()
    expect(probes).toEqual([
      {
        path: '/tags/3?tab=all',
        steps: [
          { resolve: scoped },
          { activate: scoped },
          { activate: { role: 'menuitem', name: 'Rename' } },
          { resolve: edit },
        ],
      },
    ])
  })

  it('never replays the clicks of a task that changes the world', async () => {
    const { observer, probes } = probingObserver({ scopeMatches: 1, matches: 1, visible: true })
    const renaming = { ...tagTask, endState: 'tag-renamed' }
    const result = await checkDraft(observer)({
      interfaces: [renaming],
      states: [{ id: 'tag-renamed', description: 'the tag carries its new name' }],
      proof: { 'web/rename-tag': { path: '/tags/3' } },
    })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('`web/rename-tag` step 3')
    expect(result.content).toContain('the task changes the world')
    expect(result.content).toContain('never a control that submits, deletes, cancels or signs out')
    // The first step needs no replay, so it is still proven — alone.
    expect(probes).toEqual([{ path: '/tags/3', steps: [{ resolve: scoped }] }])
  })

  it('refuses to replay past an input, and walks the listed actions instead', async () => {
    const withInput = {
      ...tagTask,
      steps: [
        { kind: 'input', target: { role: 'textbox', name: 'Filter' } },
        { kind: 'activate', target: edit, why: 'icon-only edit button' },
      ],
    }
    const { observer, probes } = probingObserver({ matches: 1, visible: true })
    const refused = await checkDraft(observer)({ interfaces: [withInput], proof: { 'web/rename-tag': { path: '/tags/3' } } })
    expect(refused.isError).toBe(true)
    expect(refused.content).toContain('an input step comes before it')
    expect(probes).toEqual([])

    const listed = await checkDraft(observer)({
      interfaces: [withInput],
      proof: { 'web/rename-tag': { path: '/tags/3', steps: [{ fill: { role: 'textbox', name: 'Filter' }, value: 'work' }] } },
    })
    expect(listed.isError).toBeUndefined()
    expect(probes).toEqual([
      { path: '/tags/3', steps: [{ fill: { role: 'textbox', name: 'Filter' }, value: 'work' }, { resolve: edit }] },
    ])
  })

  it('reads an owed step right before the listed action that acts on it', async () => {
    const { observer, probes } = probingObserver({ scopeMatches: 1, matches: 1, visible: true })
    const result = await checkDraft(observer)({
      interfaces: [tagTask],
      proof: {
        'web/rename-tag': {
          path: '/tags/3',
          steps: [{ activate: { within: { css: 'main' }, title: 'More' } }, { activate: { role: 'menuitem', name: 'Rename' } }],
        },
      },
    })
    expect(result.isError).toBeUndefined()
    expect(probes[0]?.steps).toEqual([
      { resolve: scoped },
      { activate: { within: { css: 'main' }, title: 'More' } },
      { activate: { role: 'menuitem', name: 'Rename' } },
      { resolve: edit },
    ])
  })

  it('treats a navigate back to the entry as a fresh page, replaying nothing from before it', async () => {
    const { observer, probes } = probingObserver({ matches: 1, visible: true })
    const task = {
      ...linksTask([
        { kind: 'activate', target: { role: 'button', name: 'Show archived' } },
        { kind: 'navigate', route: '/links' },
        sortStep,
      ]),
    }
    const result = await checkDraft(observer)({ interfaces: [task] })
    expect(result.isError).toBeUndefined()
    expect(probes).toEqual([
      { path: '/links', steps: [{ activate: { role: 'button', name: 'Show archived' } }, { navigate: '/links' }, { resolve: sortStep.target }] },
    ])
  })
})

describe('a css readable', () => {
  function checkLinksDraft(observer?: LiveScreenObserver) {
    const tools = buildAuthorTools({
      repoRoot: '/nowhere',
      derived: DERIVED,
      authored: null,
      replaceable: new Set(),
      scope: { screenId: 'links', address: '/links' },
      ...(observer ? { live: { observer } } : {}),
    })
    const tool = tools.find((t) => t.name === 'check_draft')!
    return (args: unknown) => tool.execute(args, toolContext)
  }
  const cards = { within: { css: 'main .cards' }, item: 'generic', template: '<title>', slots: [{ name: 'title', kind: 'text' }], why: 'the card list is plain divs with no list role' }
  const screen = (rows: unknown[]) => ({
    id: 'links',
    kind: 'screen',
    title: '/links',
    address: '/links',
    readables: { markers: [], elements: [], controls: [], rows },
  })

  it('needs a `why`', async () => {
    const { observer } = probingObserver({ matches: 1, visible: true })
    const result = await checkLinksDraft(observer)({ interfaces: [], resources: [screen([{ ...cards, why: undefined }])] })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('must say `why`')
  })

  it('is refused when the run has no live screen to prove it on', async () => {
    const result = await checkLinksDraft()({ interfaces: [], resources: [screen([cards])] })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('no live screen to prove it on')
  })

  it('is proven at the screen address, and a dialog fact after the actions that open the dialog', async () => {
    const { observer, probes } = probingObserver({ matches: 1, visible: true })
    const dialog = {
      id: 'delete-link',
      kind: 'dialog',
      title: 'Delete link',
      of: 'links',
      readables: {
        markers: [{ marker: 'Delete link', within: { css: 'div:has(> div > button[data-testid="close"])' }, why: 'the modal has no dialog role' }],
        elements: [],
        controls: [],
        rows: [],
      },
    }
    const result = await checkLinksDraft(observer)({
      interfaces: [],
      resources: [screen([cards]), dialog],
      proof: { 'delete-link': { steps: [{ activate: { role: 'button', name: 'Delete' } }] } },
    })
    expect(result.isError, String(result.content)).toBeFalsy()
    expect(probes).toEqual([
      { path: '/links', steps: [{ resolve: { css: 'main .cards' } }] },
      {
        path: '/links',
        steps: [{ activate: { role: 'button', name: 'Delete' } }, { resolve: { css: 'div:has(> div > button[data-testid="close"])' } }],
      },
    ])
  })

  it('names the way into a dialog when its fact did not resolve on the bare screen', async () => {
    const { observer } = probingObserver({ matches: 0, visible: false })
    const result = await checkLinksDraft(observer)({
      interfaces: [],
      resources: [
        screen([]),
        { id: 'delete-link', kind: 'dialog', title: 'Delete link', of: 'links', readables: { markers: [{ marker: 'Delete link', within: { css: 'div.modal' }, why: 'no dialog role' }], elements: [], controls: [], rows: [] } },
      ],
    })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('matches nothing on /links')
    expect(result.content).toContain('proof: {"delete-link": {"steps": [...]}}')
  })
})

describe('a screen no principal reaches', () => {
  /** An observer every page sends away, remembering every request. */
  function sentAwayObserver(principal?: string): { observer: LiveScreenObserver; probes: LocatorProbeRequest[] } {
    const probes: LocatorProbeRequest[] = []
    return {
      probes,
      observer: {
        ...(principal ? { principal } : {}),
        async observe() {
          return { ok: false, reason: 'not used' }
        },
        async probe(request) {
          probes.push(request)
          return { ok: false, reason: `${request.path} could not be reached`, unreached: true }
        },
        async close() {},
      },
    }
  }

  it('accepts a css step written from source, stamped unproven, once every principal is sent away', async () => {
    const { observer, probes } = sentAwayObserver('webSession')
    const anonymous = sentAwayObserver('anonymous')
    const tools = buildAuthorTools({
      repoRoot: '/nowhere',
      derived: DERIVED,
      authored: null,
      replaceable: new Set(),
      live: { observer, principals: new Map([['webSession', observer], ['anonymous', anonymous.observer]]) },
    })
    const result = await tools.find((t) => t.name === 'check_draft')!.execute({ interfaces: [linksTask([sortStep])] }, toolContext)
    expect(result.isError, String(result.content)).toBeFalsy()
    // The task's own proof, then every principal asked whether it reaches the address.
    expect(probes.map((probe) => probe.steps.length)).toEqual([1, 0])
    expect(anonymous.probes).toHaveLength(1)
    const draft = (result.artifact as { fragment: { interfaces: { steps: { proven?: false }[] }[] } }).fragment
    expect(draft.interfaces[0].steps[0].proven).toBe(false)
  })

  it('is the only place a css step goes unproven: a session’s own `proven: false` is dropped and the proof runs', async () => {
    const { observer, probes } = probingObserver({ matches: 0, visible: false })
    const result = await checkDraft(observer)({ interfaces: [linksTask([{ ...sortStep, proven: false }])] })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('matches nothing')
    expect(probes).toHaveLength(1)
  })
})

describe('a task performed by another principal', () => {
  function checkAs(principals: Record<string, LiveScreenObserver>, own: LiveScreenObserver) {
    const tools = buildAuthorTools({
      repoRoot: '/nowhere',
      derived: DERIVED,
      authored: null,
      replaceable: new Set(),
      live: { observer: own, principals: new Map(Object.entries(principals)) },
    })
    const tool = tools.find((t) => t.name === 'check_draft')!
    return (args: unknown) => tool.execute(args, toolContext)
  }

  it('is proven as that principal', async () => {
    const own = probingObserver({ matches: 0, visible: false })
    const admin = probingObserver({ matches: 1, visible: true })
    const check = checkAs({ adminWebSession: admin.observer, anonymous: probingObserver({ matches: 0, visible: false }).observer }, own.observer)
    const result = await check({ interfaces: [{ ...linksTask([sortStep]), principal: 'adminWebSession' }] })
    expect(result.isError, String(result.content)).toBeFalsy()
    expect(admin.probes).toHaveLength(1)
    expect(own.probes).toHaveLength(0)
  })

  it('is refused when it names a principal the run cannot observe as', async () => {
    const own = probingObserver({ matches: 1, visible: true })
    const result = await checkAs({ anonymous: own.observer }, own.observer)({ interfaces: [{ ...linksTask([sortStep]), principal: 'rootSession' }] })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('names principal `rootSession`, which the run cannot observe as')
  })
})
