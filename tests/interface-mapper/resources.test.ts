/**
 * RESOURCE FORMATION — the cli command groups and the api REST nouns.
 *
 * The api half is the one with a real rule in it. The obvious derivation ("the
 * last static segment is the noun") mints every RPC tail — `/cancel`,
 * `/dismiss`, `/refresh` — as a place; the SOM experiment measured 87 of them
 * over this repo's own 137 operations. These tests pin the verb/noun rule that
 * replaces it, edge by edge, and the ownership it produces.
 */

import { describe, it, expect } from 'vitest'
import { formApiResources, formCliResources, formWebResources } from '../../packages/interface-mapper/src/resources'
import { interfaceFingerprint, type Interface } from '../../packages/shared/src/interfaces'

function cliIface(command: string[]): Interface {
  const entry = { command }
  const steps: Interface['steps'] = [{ kind: 'invoke', command, flags: [] }]
  return {
    id: `cli/${command.join('-')}`,
    type: 'cli',
    title: command.join(' '),
    entry,
    steps,
    fingerprint: interfaceFingerprint({ type: 'cli', entry, steps }),
  }
}

function apiIface(method: string, path: string): Interface {
  const entry = { method, path }
  const steps: Interface['steps'] = [{ kind: 'request', method, path }]
  return {
    id: `api/${method.toLowerCase()}${path.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}`,
    type: 'api',
    title: `${method} ${path}`,
    entry,
    steps,
    fingerprint: interfaceFingerprint({ type: 'api', entry, steps }),
  }
}

describe('formCliResources', () => {
  const tree = [
    cliIface(['analyze']),
    cliIface(['spec']),
    cliIface(['spec', 'scan']),
    cliIface(['spec', 'docs']),
    cliIface(['spec', 'docs', 'exclude']),
    cliIface(['spec', 'docs', 'include']),
  ]

  it('is one group per command-tree parent, rooted at the program', () => {
    const { resources } = formCliResources(tree, { programName: 'truecourse' })
    expect(resources).toEqual([
      { id: 'truecourse', kind: 'command-group', title: 'truecourse' },
      { id: 'spec', kind: 'command-group', title: 'truecourse spec', of: 'truecourse' },
      { id: 'spec-docs', kind: 'command-group', title: 'truecourse spec docs', of: 'spec' },
    ])
  })

  it('places each command in the group it is REGISTERED IN, the way --help lists it', () => {
    const { owners } = formCliResources(tree, { programName: 'truecourse' })
    expect(Object.fromEntries(owners)).toEqual({
      'cli/analyze': 'truecourse',
      // A group that is itself invocable sits in ITS parent — a command never
      // sits with its own children.
      'cli/spec': 'truecourse',
      'cli/spec-scan': 'spec',
      'cli/spec-docs': 'spec',
      'cli/spec-docs-exclude': 'spec-docs',
      'cli/spec-docs-include': 'spec-docs',
    })
  })

  it('mints the ancestor of a deep command even when nothing is registered at it', () => {
    const { resources } = formCliResources([cliIface(['a', 'b', 'c'])], { programName: 'p' })
    expect(resources.map((r) => [r.id, r.of])).toEqual([
      ['p', undefined],
      ['a', 'p'],
      ['a-b', 'a'],
    ])
  })

  it('without a program name there is no honest root — top-level commands stay unowned', () => {
    const { resources, owners } = formCliResources(tree)
    expect(resources.map((r) => r.id)).toEqual(['spec', 'spec-docs'])
    expect(owners.get('cli/analyze')).toBeUndefined()
    expect(owners.get('cli/spec')).toBeUndefined()
    // …and the nested groups still form: their names come from the paths.
    expect(owners.get('cli/spec-docs-exclude')).toBe('spec-docs')
  })

  it('ignores every non-cli entry', () => {
    expect(formCliResources([apiIface('GET', '/todos')]).resources).toEqual([])
  })
})

describe('formApiResources — the verb/noun rule', () => {
  const surface = [
    apiIface('GET', '/api/repos'),
    apiIface('POST', '/api/repos'),
    apiIface('GET', '/api/repos/{id}'),
    apiIface('GET', '/api/repos/{id}/analyses'),
    apiIface('POST', '/api/repos/{id}/analyses'),
    // The RPC tail: a POST with no GET at it and no parameter under it.
    apiIface('POST', '/api/repos/{id}/analyses/cancel'),
    // A sub-resource: a GET is rooted exactly at it.
    apiIface('GET', '/api/repos/{id}/analyses/diff'),
  ]

  it('a static tail with a GET at it is a noun; one without is an action on the noun above', () => {
    const { resources } = formApiResources(surface)
    expect(resources.map((r) => r.id)).toEqual([
      'api',
      'api-repos',
      'api-repos-analyses',
      'api-repos-analyses-diff',
    ])
    // `cancel` is nowhere in the registry — it is a verb, not a place.
    expect(resources.map((r) => r.id)).not.toContain('api-repos-analyses-cancel')
  })

  it('an action belongs to the noun it is issued to, and an instance to its thing', () => {
    const { owners } = formApiResources(surface)
    expect(owners.get('api/post-api-repos-id-analyses-cancel')).toBe('api-repos-analyses')
    // A path parameter is an INSTANCE of the noun above it, never a place.
    expect(owners.get('api/get-api-repos-id')).toBe('api-repos')
    expect(owners.get('api/get-api-repos-id-analyses-diff')).toBe('api-repos-analyses-diff')
  })

  it('a node with children is a noun even with no operation of its own', () => {
    // `/analytics` is never read directly; it exists only as the parent of four
    // reads. It is still the place they sit in, and the `of` chain needs it.
    const { resources, owners } = formApiResources([
      apiIface('GET', '/api/repos/{id}/analytics/trend'),
      apiIface('GET', '/api/repos/{id}/analytics/breakdown'),
    ])
    const analytics = resources.find((r) => r.id === 'api-repos-analytics')!
    expect(analytics).toEqual({
      id: 'api-repos-analytics',
      kind: 'rest-noun',
      title: '/api/repos/{id}/analytics',
      of: 'api-repos',
    })
    expect([...owners.values()].sort()).toEqual([
      'api-repos-analytics-breakdown',
      'api-repos-analytics-trend',
    ])
  })

  it('a path’s FIRST named segment is always a noun — there is nothing above it to act on', () => {
    // A write-only root is still a place: no GET, no children, but no enclosing
    // noun either, so the rule's third clause carries it.
    const { resources, owners } = formApiResources([apiIface('POST', '/webhooks')])
    expect(resources).toEqual([{ id: 'webhooks', kind: 'rest-noun', title: '/webhooks' }])
    expect(owners.get('api/post-webhooks')).toBe('webhooks')
  })

  it('a verb that takes a parameter reads as a noun — the surface itself says so', () => {
    // The knowable edge, accepted deliberately: `/retry/{id}` has an instance,
    // which is what a thing has.
    const { resources } = formApiResources([apiIface('POST', '/jobs/retry/{id}')])
    expect(resources.map((r) => r.id)).toEqual(['jobs', 'jobs-retry'])
  })

  it('one place per parameter POSITION, whatever the route table names it', () => {
    // Two spellings of the same slot describe one place, not two.
    const { resources } = formApiResources([
      apiIface('GET', '/repos/{id}/files'),
      apiIface('GET', '/repos/{repoId}/rules'),
    ])
    expect(resources.map((r) => r.id)).toEqual(['repos', 'repos-files', 'repos-rules'])
  })

  it('nests every noun under the nearest noun above it, and roots the first', () => {
    const { resources } = formApiResources(surface)
    expect(resources.map((r) => [r.id, r.of])).toEqual([
      ['api', undefined],
      ['api-repos', 'api'],
      ['api-repos-analyses', 'api-repos'],
      ['api-repos-analyses-diff', 'api-repos-analyses'],
    ])
  })

  it('ids stay unique when two different paths slugify alike', () => {
    const { resources } = formApiResources([
      apiIface('GET', '/a/b-c'),
      apiIface('GET', '/a/b/c'),
    ])
    expect(new Set(resources.map((r) => r.id)).size).toBe(resources.length)
  })

  it('ignores every non-api entry, and an empty surface forms nothing', () => {
    expect(formApiResources([cliIface(['analyze'])]).resources).toEqual([])
    expect(formApiResources([]).resources).toEqual([])
  })
})

describe('formWebResources', () => {
  const place = (address: string) => ({
    kind: 'screen' as const,
    address,
    idiom: 'next-app' as const,
    filePath: `/r/app${address}/page.tsx`,
  })

  it('is one screen per address, carrying the address a navigate step reaches it by', () => {
    const { resources } = formWebResources([
      place('/'),
      place('/t/{teamUrl}/documents/{id}/edit'),
      place('/reschedule/{uid}'),
    ])
    expect(resources).toEqual([
      { id: 'root', kind: 'screen', title: '/', address: '/' },
      {
        id: 't-teamurl-documents-id-edit',
        kind: 'screen',
        title: '/t/{teamUrl}/documents/{id}/edit',
        address: '/t/{teamUrl}/documents/{id}/edit',
      },
      { id: 'reschedule-uid', kind: 'screen', title: '/reschedule/{uid}', address: '/reschedule/{uid}' },
    ])
  })

  it('nests nothing — a screen sits on nothing, which is the schema’s own rule', () => {
    const { resources } = formWebResources([place('/documents'), place('/documents/{id}')])
    expect(resources.every((r) => r.of === undefined)).toBe(true)
  })

  it('keeps ids unique when two addresses slugify alike, and owns no interface', () => {
    const { resources, owners } = formWebResources([place('/a/b-c'), place('/a/b/c')])
    expect(new Set(resources.map((r) => r.id)).size).toBe(2)
    // The tasks are a later slice: this formation places nothing, because there
    // is nothing of type `web` to place.
    expect(owners.size).toBe(0)
  })

  it('forms nothing from an empty tree', () => {
    expect(formWebResources([]).resources).toEqual([])
    expect(formWebResources([]).seeds.size).toBe(0)
  })

  /**
   * The id is minted here and the module arrives on the seed, so this is the one
   * place the two can be joined (item 105). It stays OUT of the registry entry:
   * a file path is not surface-visible shape, and it goes stale the moment a file
   * moves.
   */
  it('hands back which module each place’s id was minted from, without storing it', () => {
    const { resources, seeds } = formWebResources([place('/'), place('/availability')])
    expect([...seeds].map(([id, seed]) => [id, seed.filePath])).toEqual([
      ['root', '/r/app//page.tsx'],
      ['availability', '/r/app/availability/page.tsx'],
    ])
    expect(resources.every((r) => !('filePath' in r))).toBe(true)
  })
})
