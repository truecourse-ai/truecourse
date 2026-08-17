/**
 * THE RULES A DRAFT IS HELD TO — the half of interface authoring that is not a
 * model at all. A session hands back JSON; what makes it a catalog entry is
 * every check below, and each one exists because the alternative is a plausible
 * entry that no scenario can ever run (a locator nothing matches, an id that
 * names two things, a task located at a place the registry never defines).
 */

import { describe, it, expect } from 'vitest'
import {
  AuthoredTaskSchema,
  stampFragment,
  validateFragment,
  type AuthoredFragment,
} from '../../packages/interface-author/src/draft'
import { interfaceFingerprint, type InterfacesFile } from '../../packages/shared/src/index'

const DERIVED: InterfacesFile = {
  version: 2,
  generatedAt: '2026-08-17T00:00:00.000Z',
  recipeFingerprint: 'sha256:recipe',
  interfaces: [
    {
      id: 'api/get-api-repos',
      type: 'api',
      title: 'list repositories',
      entry: { method: 'GET', path: '/api/repos' },
      steps: [{ kind: 'request', method: 'GET', path: '/api/repos' }],
      fingerprint: 'sha256:api-repos',
    },
  ],
  resources: {
    web: [
      { id: 'root', kind: 'screen', title: '/', address: '/' },
      { id: 'repos-repoid', kind: 'screen', title: '/repos/{repoId}', address: '/repos/{repoId}' },
    ],
  },
  source: { api: 'tree' },
}

function task(overrides: Partial<AuthoredFragment['interfaces'][number]> = {}) {
  return {
    id: 'web/add-repository-by-path',
    type: 'web' as const,
    title: 'Register a repository from its path',
    group: 'home',
    entry: { method: 'GET', path: '/' },
    steps: [
      { kind: 'input' as const, target: 'textbox "Repository path"' },
      { kind: 'activate' as const, target: 'button "Add Repository"' },
    ],
    at: 'root',
    apiEffects: ['api/get-api-repos'],
    ...overrides,
  }
}

const fragment = (overrides: Partial<AuthoredFragment> = {}): AuthoredFragment => ({
  interfaces: [task()],
  ...overrides,
})

const validate = (f: AuthoredFragment, extra: Partial<Parameters<typeof validateFragment>[0]> = {}) =>
  validateFragment({ derived: DERIVED, authored: null, fragment: f, ...extra })

describe('the fingerprint is computed, never authored', () => {
  it('stamps each task with the fingerprint of its own entry and steps', () => {
    const stamped = stampFragment(fragment())
    expect(stamped.interfaces[0].fingerprint).toBe(
      interfaceFingerprint({ type: 'web', entry: task().entry, steps: task().steps }),
    )
  })

  it('refuses a fingerprint field in the draft at all', () => {
    expect(AuthoredTaskSchema.safeParse({ ...task(), fingerprint: 'sha256:mine' }).success).toBe(false)
  })
})

describe('an id names one thing', () => {
  it('accepts a task that stands on a derived place', () => {
    const result = validate(fragment())
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    // The authored file it produces carries the task and nothing derived.
    expect(result.authored!.interfaces.map((i) => i.id)).toEqual(['web/add-repository-by-path'])
  })

  it('refuses two tasks with the same id', () => {
    const result = validate(fragment({ interfaces: [task(), task({ title: 'Another' })] }))
    expect(result.errors.some((e) => e.includes('authored twice'))).toBe(true)
  })

  it('refuses an id that already exists in the authored file', () => {
    const authored: InterfacesFile = {
      ...DERIVED,
      interfaces: [{ ...task(), fingerprint: 'sha256:old' }],
      resources: undefined,
      source: undefined,
    }
    const result = validate(fragment(), { authored })
    expect(result.errors.some((e) => e.includes('is already authored'))).toBe(true)
  })

  it('lets a re-author replace exactly the ids it was given', () => {
    const authored: InterfacesFile = {
      ...DERIVED,
      interfaces: [{ ...task(), title: 'stale', fingerprint: 'sha256:old' }],
      resources: undefined,
      source: undefined,
    }
    const result = validate(fragment(), {
      authored,
      replaceable: new Set(['web/add-repository-by-path']),
    })
    expect(result.ok).toBe(true)
    expect(result.authored!.interfaces).toHaveLength(1)
    expect(result.authored!.interfaces[0].title).toBe('Register a repository from its path')
  })

  it('refuses an id that shadows a derived interface', () => {
    const result = validate(
      fragment({ interfaces: [task({ id: 'web/shadow' })] }),
      {
        derived: {
          ...DERIVED,
          interfaces: [
            ...DERIVED.interfaces,
            {
              id: 'web/shadow',
              type: 'web',
              title: 'derived',
              entry: { method: 'GET', path: '/' },
              steps: [{ kind: 'navigate', route: '/' }],
              fingerprint: 'sha256:derived-web',
            },
          ],
        },
      },
    )
    expect(result.errors.some((e) => e.includes('would shadow the derivation'))).toBe(true)
  })
})

describe('a fingerprint names one task', () => {
  it('refuses a task that repeats one already in the catalog', () => {
    const twin = { ...task(), id: 'web/already-there', fingerprint: '' }
    twin.fingerprint = interfaceFingerprint({ type: 'web', entry: twin.entry, steps: twin.steps })
    const authored: InterfacesFile = { ...DERIVED, interfaces: [twin], resources: undefined, source: undefined }
    const result = validate(fragment(), { authored })
    expect(result.errors.some((e) => e.includes('is the same task as `web/already-there`'))).toBe(true)
  })
})

describe('the locator policy', () => {
  it('refuses a selector', () => {
    const result = validate(
      fragment({ interfaces: [task({ steps: [{ kind: 'activate', target: '#add-repo-button' }] })] }),
    )
    expect(result.errors.some((e) => e.includes('is not `<role> "<accessible name>"`'))).toBe(true)
  })

  it('refuses a role no ARIA vocabulary knows', () => {
    const result = validate(
      fragment({ interfaces: [task({ steps: [{ kind: 'activate', target: 'clicky "Add"' }] })] }),
    )
    expect(result.errors.some((e) => e.includes('is not an ARIA role'))).toBe(true)
  })
})

describe('a task is reachable and located where it says', () => {
  it('refuses a task with neither `at` nor a first navigate step', () => {
    const result = validate(
      fragment({ interfaces: [task({ at: undefined })] }),
    )
    expect(result.errors.some((e) => e.includes('neither where it happens'))).toBe(true)
  })

  it('refuses a navigate step that disagrees with the entry', () => {
    const result = validate(
      fragment({
        interfaces: [
          task({ at: undefined, steps: [{ kind: 'navigate', route: '/repos/{repoId}' }] }),
        ],
      }),
    )
    expect(result.errors.some((e) => e.includes('the entry IS the address'))).toBe(true)
  })

  it('refuses an entry that disagrees with the address of the place it is at', () => {
    const result = validate(fragment({ interfaces: [task({ at: 'repos-repoid' })] }))
    expect(result.errors.some((e) => e.includes('is `at` a place addressed'))).toBe(true)
  })

  it('resolves the address through a dialog the draft itself declares', () => {
    const result = validate(
      fragment({
        interfaces: [
          task({
            id: 'web/filter-rules',
            at: 'rules-dialog',
            entry: { method: 'GET', path: '/repos/{repoId}' },
            steps: [{ kind: 'activate', target: 'button "Security"' }],
          }),
        ],
        resources: [{ id: 'rules-dialog', kind: 'dialog', title: 'the Rules dialog', of: 'repos-repoid' }],
      }),
    )
    expect(result.errors).toEqual([])
  })
})

describe('the session authors ONE place', () => {
  it('refuses a task located at another screen', () => {
    const result = validate(fragment(), { scope: { screenId: 'repos-repoid', address: '/repos/{repoId}' } })
    expect(result.errors.some((e) => e.includes('is not a task of `repos-repoid`'))).toBe(true)
  })

  it('accepts a task on a dialog that sits on the scoped screen', () => {
    const result = validate(
      fragment({
        interfaces: [
          task({
            id: 'web/filter-rules',
            at: 'rules-dialog',
            entry: { method: 'GET', path: '/repos/{repoId}' },
            steps: [{ kind: 'activate', target: 'button "Security"' }],
          }),
        ],
        resources: [{ id: 'rules-dialog', kind: 'dialog', title: 'the Rules dialog', of: 'repos-repoid' }],
      }),
      { scope: { screenId: 'repos-repoid', address: '/repos/{repoId}' } },
    )
    expect(result.errors).toEqual([])
  })
})

describe('the catalog schema, checked on the MERGE', () => {
  it('refuses a state id no registry defines', () => {
    const result = validate(fragment({ interfaces: [task({ endState: 'repository-registered' })] }))
    expect(result.errors.some((e) => e.includes('is not a state the `web` registry defines'))).toBe(true)
  })

  it('accepts it once the draft defines the state', () => {
    const result = validate(
      fragment({
        interfaces: [task({ endState: 'repository-registered' })],
        states: [{ id: 'repository-registered', description: 'The repository is registered and on the home grid.' }],
      }),
    )
    expect(result.errors).toEqual([])
    expect(result.authored!.states!.web.map((s) => s.id)).toEqual(['repository-registered'])
  })

  it('refuses a place at an id nothing defines', () => {
    const result = validate(fragment({ interfaces: [task({ at: 'nowhere' })] }))
    expect(result.errors.some((e) => e.includes('is not a resource the `web` registry defines'))).toBe(true)
  })
})
