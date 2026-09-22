import { describe, expect, it } from 'vitest'
import type { InterfacesFile } from '../../packages/shared/src/index.js'
import { AuthoredFragmentSchema, stampFragment, validateFragment, type AuthoredFragment } from '../../packages/core/src/services/interface-author/draft.js'
import { scopeFragmentIds, screenIdentityGuidance, type ScopeFragmentIdsInput } from '../../packages/core/src/services/interface-author/identity.js'

/** Every place a fragment declares answers for all four readable kinds. */
const NO_READABLES = { markers: [], elements: [], controls: [], rows: [] } as const

const derived: InterfacesFile = {
  version: 2, generatedAt: '2026-09-14T00:00:00.000Z', recipeFingerprint: 'sha256:recipe', interfaces: [],
  resources: { web: [
    { id: 'documents', kind: 'screen', title: 'Documents', address: '/documents' },
    { id: 'templates', kind: 'screen', title: 'Templates', address: '/templates' },
  ] },
  states: { web: [{ id: 'signed-in', description: 'The user is signed in' }] },
}

function options(screenId = 'documents', authored: InterfacesFile | null = null): ScopeFragmentIdsInput {
  return { scope: { screenId, address: `/${screenId}` }, derived, authored, replaceable: new Set() }
}

function fragment(screenId = 'documents'): AuthoredFragment {
  return {
    interfaces: [{
      id: 'web/save', type: 'web', title: 'Save', entry: { method: 'GET', path: `/${screenId}` },
      at: 'editor-panel', to: 'confirmation', startingState: 'signed-in', endState: 'saved',
      steps: [{ kind: 'activate', target: { role: 'button', name: 'Save' } }], apiEffects: [],
    }],
    resources: [
      { id: screenId, kind: 'screen', title: screenId, address: `/${screenId}`, readables: NO_READABLES },
      { id: 'editor-panel', kind: 'panel', title: 'Editor', of: screenId, readables: NO_READABLES },
      { id: 'confirmation', kind: 'dialog', title: 'Confirmation', of: 'editor-panel', readables: NO_READABLES },
    ],
    states: [{ id: 'saved', description: 'The changes are saved' }],
    unresolved: ['A conditional preview could not be established'],
  }
}

function catalog(value: AuthoredFragment): InterfacesFile {
  const stamped = stampFragment(value)
  return {
    ...derived, interfaces: stamped.interfaces,
    resources: { web: [...derived.resources!.web, ...stamped.resources] },
    states: { web: [...derived.states!.web, ...stamped.states] },
  }
}

describe('screen-owned authoring identities', () => {
  it('keeps identically named behavior on two screens with distinct IDs and intact references', () => {
    const first = scopeFragmentIds(fragment(), options())
    const accepted = validateFragment({ ...options(), fragment: first })
    expect(accepted.errors).toEqual([])
    const secondOptions = options('templates', accepted.authored!)
    const second = scopeFragmentIds(fragment('templates'), secondOptions)
    expect(validateFragment({ ...secondOptions, fragment: second }).errors).toEqual([])
    expect(second.interfaces[0].id).not.toBe(first.interfaces[0].id)
    expect(second.resources![1].id).not.toBe(first.resources![1].id)
    for (const result of [first, second]) {
      expect(result.interfaces[0].at).toBe(result.resources![1].id)
      expect(result.interfaces[0].to).toBe(result.resources![2].id)
      expect(result.resources![2].of).toBe(result.resources![1].id)
      expect(result.resources![1].of).toBe(result.resources![0].id)
    }
  })

  it('preserves current-screen legacy task/resource IDs, including enrichment and explicit replacement', () => {
    const original = fragment()
    const input = options('documents', catalog(original))
    expect(scopeFragmentIds(original, input)).toEqual(original)
    const enrichment: AuthoredFragment = {
      interfaces: [], resources: [{ ...original.resources![1], readables: { markers: [{ marker: 'Saved' }] } }],
    }
    expect(scopeFragmentIds(enrichment, input)).toEqual(enrichment)
    const replacement = { ...options(), replaceable: new Set(['web/save']) }
    expect(scopeFragmentIds(original, replacement).interfaces[0].id).toBe('web/save')
  })

  it('remaps foreign generic IDs when the new definitions are owned by this screen', () => {
    const foreign = catalog(fragment('templates'))
    const scoped = scopeFragmentIds(fragment(), options('documents', foreign))
    expect(scoped.interfaces[0].id).not.toBe('web/save')
    expect(scoped.resources![1].id).not.toBe('editor-panel')
    expect(scoped.resources![2].id).not.toBe('confirmation')
    expect(validateFragment({ ...options('documents', foreign), fragment: scoped }).errors).toEqual([])
  })

  it('resolves new nesting through a partial enrichment of an existing owned panel', () => {
    const original = fragment()
    const input = options('documents', catalog(original))
    const draft: AuthoredFragment = {
      interfaces: [{
        ...original.interfaces[0], id: 'web/show-note', at: 'note',
        steps: [{ kind: 'activate', target: { role: 'button', name: 'Show note' } }],
      }],
      resources: [
        { id: 'editor-panel', kind: 'panel', title: 'Editor', readables: { markers: [{ marker: 'Editing' }] } },
        { id: 'note', kind: 'panel', title: 'Note', of: 'editor-panel', readables: NO_READABLES },
      ],
    }
    const scoped = scopeFragmentIds(draft, input)
    expect(scoped.resources![0].id).toBe('editor-panel')
    expect(scoped.resources![1].id).not.toBe('note')
    expect(scoped.resources![1].of).toBe('editor-panel')
    expect(scoped.interfaces[0].at).toBe(scoped.resources![1].id)
    expect(validateFragment({ ...input, fragment: scoped }).errors).toEqual([])
  })

  it('is deterministic and idempotent before and after catalog persistence', () => {
    const original = fragment()
    const before = structuredClone(original)
    const scoped = scopeFragmentIds(original, options())
    expect(scopeFragmentIds(original, options())).toEqual(scoped)
    expect(scopeFragmentIds(scoped, options())).toEqual(scoped)
    expect(scopeFragmentIds(scoped, options('documents', catalog(scoped)))).toEqual(scoped)
    expect(original).toEqual(before)
    expect(scopeFragmentIds(original, { ...options(), scope: undefined })).toBe(original)
  })

  it('retains screen and shared state identities without changing steps or unresolved evidence', () => {
    const original = fragment()
    const scoped = scopeFragmentIds(original, options())
    expect(scoped.resources![0]).toEqual(original.resources![0])
    expect(scoped.interfaces[0].startingState).toBe('signed-in')
    expect(scoped.interfaces[0].endState).toBe('saved')
    expect(scoped.interfaces[0].steps).toEqual(original.interfaces[0].steps)
    expect(scoped.states).toEqual(original.states)
    expect(scoped.unresolved).toEqual(original.unresolved)
  })

  it('does not repair foreign ownership or disguise changes to a derived root screen', () => {
    const bad = fragment('templates')
    const scoped = scopeFragmentIds(bad, options())
    expect(scoped.resources).toEqual(bad.resources)
    expect(validateFragment({ ...options(), fragment: scoped }).ok).toBe(false)
    const rootChange: AuthoredFragment = {
      interfaces: [], resources: [{ id: 'templates', kind: 'dialog', title: 'Bad root change', of: 'documents' }],
    }
    const normalized = scopeFragmentIds(rootChange, options())
    expect(normalized.resources![0].id).toBe('templates')
    expect(validateFragment({ ...options(), fragment: normalized }).errors.some((error) => error.includes('kind'))).toBe(true)
  })

  it('leaves cyclic nesting and invalid identifiers for validation to reject', () => {
    const value = fragment()
    value.interfaces[0].id = 'web/Save changes!'
    value.resources![1].of = 'confirmation'
    const scoped = scopeFragmentIds(value, options())
    expect(scoped.interfaces[0].id).toBe('web/Save changes!')
    expect(scoped.resources).toEqual(value.resources)
    expect(validateFragment({ ...options(), fragment: scoped }).ok).toBe(false)
  })

  it('bounds long identities and distinguishes equal readable prefixes with hashes', () => {
    const value = fragment()
    value.interfaces[0].id = `web/${'long-'.repeat(100)}save`
    const first = scopeFragmentIds(value, options(`${'screen-'.repeat(100)}one`))
    const second = scopeFragmentIds(value, options(`${'screen-'.repeat(100)}two`))
    expect(first.interfaces[0].id.length).toBeLessThanOrEqual(160)
    expect(second.interfaces[0].id).not.toBe(first.interfaces[0].id)
    value.interfaces[0].id += '-another'
    const third = scopeFragmentIds(value, options(`${'screen-'.repeat(100)}one`))
    expect(third.interfaces[0].id).not.toBe(first.interfaces[0].id)
    expect(AuthoredFragmentSchema.safeParse(first).success).toBe(true)
    expect(screenIdentityGuidance(options().scope)).toContain('Screen IDs and shared state IDs retain their catalog names')
    expect(screenIdentityGuidance()).toBe('')
  })
})
