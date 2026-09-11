import { describe, expect, it } from 'vitest'
import { buildResourceHints } from '../../packages/guard-generator/src/grounding.js'
import type { Interface, InterfaceResource } from '@truecourse/shared'
import { createAuthorCatalog, scopedAuthorResources, AUTHOR_SUMMARY_CHARS, AUTHOR_TOOL_RESULT_CHARS } from '../../packages/guard-generator/src/author-catalog.js'

const action = (n: number): Interface => ({ id: `web/action-${String(n).padStart(4, '0')}`, type: 'web', title: `Action ${n}`, entry: { method: 'GET', path: `/screen/${n}` }, steps: [{ kind: 'activate', target: `button "Action ${n}"` }], fingerprint: `fp${n}`, at: 'panel' })
const resources: Record<string, InterfaceResource[]> = { web: [{ id: 'screen', title: 'Screen', kind: 'screen', address: '/screen' }, { id: 'panel', title: 'Panel', kind: 'panel', of: 'screen', readables: { markers: Array.from({ length: 1200 }, (_, n) => ({ id: `marker-${n}`, text: `Marker ${n}` })) } }] }
const parse = (r: { content: string }) => JSON.parse(r.content)

describe('author catalog', () => {
  it('marks all requested actions complete before finishing optional resource pages', () => {
    const entries = [action(0), action(1)]
    const catalog = createAuthorCatalog(entries, resources)
    const first = parse(catalog.get({ ids: entries.map(entry => entry.id) }))
    expect(first.actionCompleteIds).toEqual(entries.map(entry => entry.id))
    expect(first.complete).toBe(false)
    expect(first.nextCursor).toBeDefined()
    const firstResource = first.items.findIndex((item: { path: string[] }) => item.path[0] === 'resources')
    expect(firstResource).toBeGreaterThan(0)
    expect(first.items.slice(0, firstResource).every((item: { path: string[] }) => item.path[0] === 'interface')).toBe(true)
    expect(first.items.slice(0, firstResource).some((item: { id: string }) => item.id === entries[1].id)).toBe(true)
    const next = parse(catalog.get({ ids: entries.map(entry => entry.id), cursor: first.nextCursor }))
    expect(next.actionCompleteIds).toEqual(entries.map(entry => entry.id))
    expect(next.items.every((item: { path: string[] }) => item.path[0] === 'resources')).toBe(true)
  })

  it('never marks a partially returned action complete, and retains completion across resource pages', () => {
    const first = action(0)
    const second = { ...action(1), title: 't'.repeat(7000), startingState: 's'.repeat(7000) }
    const catalog = createAuthorCatalog([first, second], resources)
    const ids = [first.id, second.id]
    const page1 = parse(catalog.get({ ids }))
    expect(page1.actionCompleteIds).toEqual([first.id])
    const page2 = parse(catalog.get({ ids, cursor: page1.nextCursor }))
    expect(page2.actionCompleteIds).toEqual(ids)
    expect(page2.complete).toBe(false)
    const page3 = parse(catalog.get({ ids, cursor: page2.nextCursor }))
    expect(page3.actionCompleteIds).toEqual(ids)
  })

  it('does not expose mutable snapshot metadata through candidate summaries', () => {
    const catalog = createAuthorCatalog([action(0)])
    const fingerprint = catalog.fingerprint
    const before = catalog.search({ query: '/screen/0' }).content
    const candidate = catalog.candidates([], 'Action')[0]
    candidate.entry!.path = '/mutated'
    candidate.omittedFields.push('invented')
    expect(catalog.search({ query: '/screen/0' }).content).toBe(before)
    expect(parse(catalog.search({ query: '/mutated' })).total).toBe(0)
    expect(catalog.get({ ids: [action(0).id] }).content).not.toContain('/mutated')
    expect(catalog.candidates([], 'Action')[0].omittedFields).not.toContain('invented')
    expect(catalog.fingerprint).toBe(fingerprint)
  })

  it('bounds oversized optional summary metadata while retaining search recall and full retrieval', () => {
    const entries = Array.from({ length: 6 }, (_, n) => ({
      ...action(n), title: `needle ${'t'.repeat(7000)}`,
      entry: { method: 'GET', path: `/${'p'.repeat(7000)}` },
      startingState: 's'.repeat(7000), endState: 'e'.repeat(7000),
    }))
    const normal = { ...action(7), title: 'Normal late action' }
    const catalog = createAuthorCatalog([...entries, normal])
    const candidates = catalog.candidates([], 'needle')
    expect(candidates).toHaveLength(6)
    for (const candidate of candidates) {
      expect(JSON.stringify(candidate).length).toBeLessThanOrEqual(AUTHOR_SUMMARY_CHARS)
      expect(candidate.omittedFields).toContain('title')
      expect(candidate.omittedFields).toContain('entry')
    }
    // All four fields individually fit a tool result but their summary does not.
    // Omitting a field in summaries must not remove it from the search index.
    expect(parse(catalog.search({ query: 'needle' })).total).toBe(6)
    const ids: string[] = []
    let cursor: string | undefined
    do {
      const report = catalog.search({ query: '', limit: 2, cursor })
      expect(report.isError).toBeUndefined()
      expect(report.content.length).toBeLessThanOrEqual(AUTHOR_TOOL_RESULT_CHARS)
      const body = parse(report)
      ids.push(...body.items.map((item: { id: string }) => item.id))
      cursor = body.nextCursor
    } while (cursor)
    expect(ids).toEqual([...entries, normal].map(entry => entry.id))
    const values: unknown[] = []
    do {
      const report = catalog.get({ ids: [entries[0].id], cursor })
      expect(report.isError).toBeUndefined()
      expect(report.content.length).toBeLessThanOrEqual(AUTHOR_TOOL_RESULT_CHARS)
      const body = parse(report)
      values.push(...body.items.map((item: { value: unknown }) => item.value))
      cursor = body.nextCursor
    } while (cursor)
    expect(values).toContain(entries[0].title)
    expect(values).toContain(entries[0].entry.path)
    expect(values).toContain(entries[0].startingState)
    expect(values).toContain(entries[0].endState)
  })

  it('reports an oversized ID as a bounded row and continues to normal later actions', () => {
    const enormous = { ...action(0), id: `web/aaa-${'x'.repeat(20_000)}`, title: 'Needle enormous identity' }
    const later = { ...action(1), id: 'web/zzz', title: 'Needle late normal identity' }
    const catalog = createAuthorCatalog([enormous, later])
    const first = catalog.search({ query: '', limit: 1 })
    expect(first.isError).toBeUndefined()
    expect(first.content.length).toBeLessThanOrEqual(AUTHOR_TOOL_RESULT_CHARS)
    const firstBody = parse(first)
    expect(firstBody.items[0].error).toBe('oversized-interface-id')
    expect(firstBody.items[0].id).toBeUndefined()
    expect(firstBody.nextCursor).toBeDefined()
    const second = parse(catalog.search({ query: '', limit: 1, cursor: firstBody.nextCursor }))
    expect(second.items[0].id).toBe(later.id)
    expect(second.complete).toBe(true)
    const candidates = catalog.candidates([], 'Needle')
    expect(candidates[0].error).toBe('oversized-interface-id')
    expect(candidates[1].id).toBe(later.id)
    for (const candidate of candidates) expect(JSON.stringify(candidate).length).toBeLessThanOrEqual(AUTHOR_SUMMARY_CHARS)
  })

  it('deduplicates resource identity by surface and id', () => {
    const items = [action(0), { ...action(0), type: 'api' as const }]
    const registry = { web: [{ id: 'panel', kind: 'panel' as const, title: 'Web panel' }], api: [{ id: 'panel', kind: 'panel' as const, title: 'API panel' }] }
    expect(buildResourceHints(items, registry).map(r => r.title)).toEqual(['Web panel', 'API panel'])
  })

  it('pages all 1200 summaries without repeats and ranks exact routes first', () => {
    const entries = Array.from({ length: 1200 }, (_, n) => action(n))
    const before = JSON.stringify(entries)
    const catalog = createAuthorCatalog(entries, resources)
    const ids: string[] = []
    let cursor: string | undefined
    do {
      const result = catalog.search({ query: '', limit: 20, cursor })
      expect(result.content.length).toBeLessThanOrEqual(AUTHOR_TOOL_RESULT_CHARS)
      const body = parse(result)
      ids.push(...body.items.map((i: Interface) => i.id))
      cursor = body.nextCursor
    } while (cursor)
    expect(ids).toEqual(entries.map(i => i.id))
    expect(parse(catalog.search({ query: '/screen/1199' })).items[0].id).toBe(entries[1199].id)
    expect(catalog.candidates([entries[0]], 'Action')).toHaveLength(6)
    expect(JSON.stringify(entries)).toBe(before)
    expect(catalog.fingerprint).toBe(createAuthorCatalog([...entries].reverse(), resources).fingerprint)
  })

  it('retrieves every authoritative field including late readables and ancestors', () => {
    const catalog = createAuthorCatalog([action(0)], resources)
    const values: unknown[] = []
    let cursor: string | undefined
    let pages = 0
    do {
      const result = catalog.get({ ids: [action(0).id], cursor })
      expect(result.isError).toBeUndefined()
      expect(result.content.length).toBeLessThanOrEqual(AUTHOR_TOOL_RESULT_CHARS)
      const body = parse(result)
      values.push(...body.items.map((i: { value: unknown }) => i.value))
      cursor = body.nextCursor
      pages++
    } while (cursor)
    expect(pages).toBeGreaterThan(1)
    expect(values).toContain('Marker 1199')
    expect(values).toContain('/screen')
    expect(values).toContain('button "Action 0"')
    expect(values.filter(v => v === 'Marker 1199')).toHaveLength(1)
  })

  it('rejects malformed, cross-query, cross-snapshot cursors and unavailable ids', () => {
    const catalog = createAuthorCatalog([action(0), action(1)])
    const cursor = parse(catalog.search({ query: '', limit: 1 })).nextCursor
    expect(catalog.search({ query: 'Action', limit: 1, cursor }).isError).toBe(true)
    expect(createAuthorCatalog([action(0), action(2)]).search({ query: '', limit: 1, cursor }).isError).toBe(true)
    expect(catalog.get({ ids: ['web/other-app'] }).isError).toBe(true)
    expect(catalog.search({ query: '', cursor: 'garbage' }).isError).toBe(true)
    expect(parse(catalog.search({ query: '.*' })).items).toEqual([])
  })

  it('reports an oversized indivisible locator explicitly without truncation', () => {
    const entry = action(0)
    entry.steps = [{ kind: 'activate', target: 'x'.repeat(13_000) }]
    const catalog = createAuthorCatalog([entry])
    let cursor: string | undefined
    let failure: { content: string; isError?: boolean }
    do {
      failure = catalog.get({ ids: [entry.id], cursor })
      cursor = parse(failure).nextCursor
    } while (cursor)
    expect(failure.isError).toBe(true)
    expect(failure.content).toContain('oversized-indivisible-field')
  })

  it('fingerprints readable and metadata changes even when not initially briefed', () => {
    const catalog = createAuthorCatalog([action(0)], resources)
    const changed = structuredClone(resources)
    changed.web[1].readables!.markers![1199].text = 'Changed'
    expect(createAuthorCatalog([action(0)], changed).fingerprint).not.toBe(catalog.fingerprint)
    expect(createAuthorCatalog([{ ...action(0), title: 'Changed' }], resources).fingerprint).not.toBe(catalog.fingerprint)
    resources.web[0].title = 'Updated after construction'
    expect(catalog.fingerprint).not.toBe(createAuthorCatalog([action(0)], resources).fingerprint)
    expect(catalog.get({ ids: [action(0).id] }).content).not.toContain('Updated after construction')
  })

  it('keeps resource identity and ancestors while deferring unrelated readables', () => {
    const selected = scopedAuthorResources([action(0)], resources)
    expect(selected.map(r => r.id)).toEqual(['panel', 'screen'])
    expect(selected[0].readables?.markers).toBeUndefined()
    const entry = action(0)
    entry.title = 'Selected marker-1199'
    expect(scopedAuthorResources([entry], resources)[0].readables?.markers?.map(m => m.id)).toEqual(['marker-1199'])
  })
})
