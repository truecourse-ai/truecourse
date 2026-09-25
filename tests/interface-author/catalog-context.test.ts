import { describe, expect, it } from 'vitest'
import type { Interface, InterfaceResource, InterfacesFile } from '@truecourse/shared'
import { mergeInterfaceCatalogs } from '@truecourse/guard-runner'
import { liveAuthorCatalog, ownTasks, ownTaskContext, MAX_OWN_TASK_BYTES } from '../../packages/core/src/services/interface-author/catalog-context'
import { buildAuthorTools } from '../../packages/core/src/services/interface-author/tools'

const task = (n: number, at = 'panel'): Interface => ({ id: `web/action-${String(n).padStart(4, '0')}`, type: 'web', title: `Action ${n}`, entry: { method: 'GET', path: '/screen' }, steps: [{ kind: 'activate', target: `button "Action ${n}"` }], fingerprint: `fp${n}`, at })
const resources: InterfaceResource[] = [
  { id: 'screen', title: 'Screen', kind: 'screen', address: '/screen' },
  { id: 'panel', title: 'Panel', kind: 'panel', of: 'screen' },
  { id: 'dialog', title: 'Dialog', kind: 'dialog', of: 'panel' },
  { id: 'cycle-a', title: 'A', kind: 'panel', of: 'cycle-b' },
  { id: 'cycle-b', title: 'B', kind: 'panel', of: 'cycle-a' },
]
const file = (interfaces: Interface[]): InterfacesFile => ({ version: 2, generatedAt: '', recipeFingerprint: '', interfaces, resources: { web: resources } })
const parse = (result: { content: string }) => JSON.parse(result.content)

describe('catalog context', () => {
  it('selects at/of ownership, excluding incoming navigation, missing parents and cycles', () => {
    const catalog = file([task(0, 'screen'), task(1), task(2, 'dialog'), task(3, 'cycle-a'), task(4, 'missing'), { ...task(5, 'elsewhere'), to: 'screen' }])
    const before = structuredClone(catalog)
    expect(ownTasks(catalog, 'screen').map(i => i.id)).toEqual([task(0).id, task(1).id, task(2).id])
    expect(catalog).toEqual(before)
  })

  it('uses authored overlay definitions without mutating either catalog', () => {
    const derived = file([task(0)])
    const authored = file([{ ...task(0), steps: [{ kind: 'activate', target: { role: 'button', name: 'New exact action' } }] }])
    const before = structuredClone({ derived, authored })
    const context = ownTaskContext({ derived, authored, screenId: 'screen' })
    expect(context).toContain('New exact action')
    expect(context).not.toContain('button \\"Action 0')
    expect(ownTasks(mergeInterfaceCatalogs(derived, authored), 'screen')).toHaveLength(1)
    expect({ derived, authored }).toEqual(before)
  })

  it('bounds whole task definitions and omission manifests in UTF-8 bytes', () => {
    const authored = file(Array.from({ length: 500 }, (_, n) => ({ ...task(n), title: '🙂'.repeat(2_000) })))
    const context = ownTaskContext({ derived: null, authored, screenId: 'screen' })
    expect(Buffer.byteLength(context)).toBeLessThanOrEqual(MAX_OWN_TASK_BYTES)
    const definitions = context.split('\n\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line))
    expect(definitions).toHaveLength(1)
    expect(definitions[0].title).toBe('🙂'.repeat(2_000))
    expect(context).toContain('499 omitted')
    expect(context).toContain('manifest incomplete')
    expect(context).toContain('Retrieve every omitted definition')
    expect(ownTaskContext({ derived: null, authored: file([]), screenId: 'screen' })).toContain('No existing web task')
    expect(ownTaskContext({ derived: null, authored, screenId: 'screen' })).toContain('Reconcile: account for every authored task')
  })

  it('finds an entry beyond 200 and returns exact steps through the real tools', async () => {
    const tools = buildAuthorTools({ repoRoot: '.', derived: file(Array.from({ length: 250 }, (_, n) => task(n))), authored: null, replaceable: new Set() })
    const call = async (name: string, args: unknown) => {
      const tool = tools.find(tool => tool.name === name)!
      return parse(await tool.execute(tool.inputSchema.parse(args), { workItem: '', signal: new AbortController().signal, dispatchChild: async () => { throw new Error('unused') } }))
    }
    const ids: string[] = []
    let cursor: string | undefined
    do {
      const page = await call('search_interfaces', { query: '', limit: 20, cursor })
      ids.push(...page.items.map((item: { id: string }) => item.id))
      cursor = page.nextCursor
    } while (cursor)
    expect(ids).toHaveLength(250)
    const detail = await call('get_interfaces', { ids: [ids[249]] })
    expect(detail.items).toContainEqual({ id: task(249).id, path: ['interface'], value: { ...task(249), origin: 'derived' } })
  })

  it('invalidates cached readers and cursors on peer catalog changes', () => {
    let authored = file([task(0), task(1)])
    const live = liveAuthorCatalog({ derived: null, get authored() { return authored } })
    const initial = live()
    const first = parse(initial.search({ query: '', limit: 1 }))
    expect(live()).toBe(initial)
    authored = file([task(0), task(1), task(2)])
    expect(live()).not.toBe(initial)
    expect(parse(live().search({ query: '', limit: 1, cursor: first.nextCursor })).error).toBe('invalid-or-stale-cursor')
    expect(parse(live().search({ query: '0002' })).total).toBe(1)
    expect(parse(initial.search({ query: '0002' })).total).toBe(0)
  })

  it('refreshes the live registry without restarting unrelated exact definition pages', () => {
    const large = { ...task(0), title: 't'.repeat(7000), startingState: 's'.repeat(7000) }
    let authored = file([large])
    const live = liveAuthorCatalog({ derived: null, get authored() { return authored } })
    const first = parse(live().get({ ids: [large.id], includeResources: false }))
    const state = { id: 'signed-in', description: 'The user is signed in.' }
    authored = { ...file([large, task(1)]), states: { web: [state] } }
    const next = parse(live().get({ ids: [large.id], includeResources: false, cursor: first.nextCursor }))
    expect(next.snapshot).toBe(first.snapshot)
    expect(next.complete).toBe(true)
    expect(parse(live().getStates({ ids: [state.id] })).items[0].value).toEqual(state)
    expect(parse(live().getResources({ ids: ['dialog'] })).items[0].value).toEqual(resources[2])
  })
})
