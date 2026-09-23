/**
 * THE RULES A DRAFT IS HELD TO — the half of interface authoring that is not a
 * model at all. A session hands back JSON; what makes it a catalog entry is
 * every check below, and each one exists because the alternative is a plausible
 * entry that no scenario can ever run (a locator nothing matches, an id that
 * names two things, a task located at a place the registry never defines).
 */

import { describe, it, expect } from 'vitest'
import {
  accountForPrior,
  AuthoredTaskSchema,
  AuthoredFragmentSchema,
  EMPTY_FRAGMENT,
  foldAuthoredFragment,
  stampFragment,
  validateFragment,
  type AuthoredFragment,
} from '../../packages/core/src/services/interface-author/draft'
import { interfaceFingerprint, type InterfacesFile } from '../../packages/shared/src/index'

/** The four empty kinds — what a place that shows nothing of them claims. */
const NO_READABLES = { markers: [], elements: [], controls: [], rows: [] } as const

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
      { kind: 'input' as const, target: { role: 'textbox', name: 'Repository path' } },
      { kind: 'activate' as const, target: { role: 'button', name: 'Add Repository' } },
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
    expect(result.errors.some((e) => e.includes('never a selector'))).toBe(true)
  })

  it('refuses a role no ARIA vocabulary knows', () => {
    const result = validate(
      fragment({ interfaces: [task({ steps: [{ kind: 'activate', target: { role: 'clicky', name: 'Add' } }] })] }),
    )
    expect(result.errors.some((e) => e.includes("received 'clicky'"))).toBe(true)
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
            steps: [{ kind: 'activate', target: { role: 'button', name: 'Security' } }],
          }),
        ],
        resources: [{ id: 'rules-dialog', kind: 'dialog', title: 'the Rules dialog', of: 'repos-repoid', readables: NO_READABLES }],
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
            steps: [{ kind: 'activate', target: { role: 'button', name: 'Security' } }],
          }),
        ],
        resources: [{ id: 'rules-dialog', kind: 'dialog', title: 'the Rules dialog', of: 'repos-repoid', readables: NO_READABLES }],
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

describe('the state registry is shared property', () => {
  const REGISTERED = 'The repository is registered and on the home grid.'
  const authored: InterfacesFile = {
    version: 2,
    generatedAt: '2026-08-17T00:00:00.000Z',
    recipeFingerprint: 'sha256:recipe',
    interfaces: [],
    states: { web: [{ id: 'repository-registered', description: REGISTERED }] },
  }

  it('accepts a task that REFERENCES an existing state, defining nothing', () => {
    const result = validate(fragment({ interfaces: [task({ endState: 'repository-registered' })] }), { authored })
    expect(result.errors).toEqual([])
    // The registry gained nothing — the reference resolved against what was there.
    expect(result.authored!.states!.web.map((s) => s.id)).toEqual(['repository-registered'])
  })

  it('refuses redefining an existing id as a different world', () => {
    const result = validate(
      fragment({
        interfaces: [task({ endState: 'repository-registered' })],
        states: [{ id: 'repository-registered', description: 'A repository row is on the grid.' }],
      }),
      { authored },
    )
    expect(result.errors.some((e) => e.includes('already names'))).toBe(true)
  })

  it('lets a re-author restate a state verbatim', () => {
    const result = validate(
      fragment({
        interfaces: [task({ endState: 'repository-registered' })],
        states: [{ id: 'repository-registered', description: REGISTERED }],
      }),
      { authored },
    )
    expect(result.errors).toEqual([])
  })

  it('reads the registry off the merged catalog — a derived state counts too', () => {
    const result = validate(
      fragment({
        interfaces: [task({ endState: 'repository-registered' })],
        states: [{ id: 'repository-registered', description: 'Something else entirely.' }],
      }),
      { derived: { ...DERIVED, states: { web: [{ id: 'repository-registered', description: REGISTERED }] } } },
    )
    expect(result.errors.some((e) => e.includes('already names'))).toBe(true)
  })
})

describe('resource enrichment', () => {
  const screen = DERIVED.resources!.web[0]
  it('preserves omitted metadata and readable kinds while replacing explicit arrays', () => {
    const derived: InterfacesFile = { ...DERIVED, resources: { web: [{ ...screen,
      description: 'The home screen', readables: { elements: [{ element: { role: 'heading', name: 'Home' } }] },
    }] } }
    // `elements` is already established on the derived place, so stating the
    // other three answers for all four kinds.
    const first = validate({ interfaces: [], resources: [{ id: 'root', title: '/', kind: 'screen',
      readables: { markers: [{ id: 'empty', marker: 'No repositories' }], controls: [], rows: [] },
    }] }, { derived, scope: { screenId: 'root', address: '/' } })
    expect(first.errors).toEqual([])
    const resource = first.authored!.resources!.web[0]
    expect(resource).toMatchObject({ address: '/', description: 'The home screen', readables: {
      markers: [{ id: 'empty', marker: 'No repositories' }], elements: [{ element: { role: 'heading', name: 'Home' } }],
    } })
    const second = validate({ interfaces: [], resources: [{ id: 'root', title: '/', kind: 'screen', readables: { markers: [] } }] },
      { derived, authored: first.authored! })
    expect(second.authored!.resources!.web[0].readables).toEqual({
      markers: [], elements: resource.readables!.elements, controls: [], rows: [],
    })
  })

  /**
   * An omitted readable kind is UNKNOWN, and the ledger closes the screen the
   * moment the outcome is accepted — so the write path refuses the fragment
   * rather than filling the array in, which would be the engine claiming a
   * reading nobody made.
   */
  it('refuses a declared place that leaves a readable kind unstated', () => {
    const missing = validate({ interfaces: [], resources: [{ id: 'root', title: '/', kind: 'screen',
      readables: { markers: [], elements: [], controls: [] } }] }, { scope: { screenId: 'root', address: '/' } })
    expect(missing.ok).toBe(false)
    expect(missing.errors.join('\n')).toContain('`root` leaves `rows` unstated')
    expect(missing.errors.join('\n')).toContain('`[]` when this place has none of that kind')

    const none = validate({ interfaces: [], resources: [{ id: 'root', title: '/', kind: 'screen' }] },
      { scope: { screenId: 'root', address: '/' } })
    expect(none.errors.join('\n')).toContain('leaves `markers`, `elements`, `controls`, `rows` unstated')

    // The four explicit empties are a claim, and they are accepted as one.
    const stated = validate({ interfaces: [], resources: [{ id: 'root', title: '/', kind: 'screen',
      readables: { markers: [], elements: [], controls: [], rows: [] } }] }, { scope: { screenId: 'root', address: '/' } })
    expect(stated.errors).toEqual([])
    expect(stated.authored!.resources!.web[0].readables).toEqual({ markers: [], elements: [], controls: [], rows: [] })
  })

  it('rejects resource-only writes outside the screen scope and changes to place identity', () => {
    const foreign = validate({ interfaces: [], resources: [{ ...DERIVED.resources!.web[1], readables: { markers: [] } }] },
      { scope: { screenId: 'root', address: '/' } })
    expect(foreign.errors.join('\n')).toContain('not a resource of `root`')
    expect(validate({ interfaces: [], resources: [{ ...screen, address: '/elsewhere' }] }).errors.join('\n')).toContain('cannot change its existing `address`')
    expect(validate({ interfaces: [], resources: [screen, screen] }).errors.join('\n')).toContain('declared twice')
    expect(validate({ interfaces: [], resources: [{ id: 'cli-group', kind: 'command-group', title: 'CLI', of: 'root' }] }).ok).toBe(false)
  })

  it('uses the shared readable validators for locators, slots, states and ids', () => {
    const bad = [
      { elements: [{ element: { css: '#heading' } }] },
      { controls: [{ control: { role: 'checkbox', name: 'Enabled' }, states: ['visible'] }] },
      { rows: [{ item: 'row', template: '<name>', slots: [{ name: 'wrong', kind: 'text' }] }] },
      { markers: [{ id: 'same', marker: 'Home' }], elements: [{ id: 'same', element: { role: 'heading', name: 'Home' } }] },
    ]
    for (const readables of bad) {
      expect(validate({ interfaces: [], resources: [{ ...screen, readables }] } as AuthoredFragment).ok).toBe(false)
    }
  })
})


describe('control type and scope survive authoring', () => {
  it('accepts native select input and a confirmation scoped to its dialog', () => {
    const steps = [
      { kind: 'input' as const, target: { role: 'combobox', name: 'Category' }, mode: 'select' as const, within: { role: 'dialog' as const, name: 'Edit expense' } },
      { kind: 'activate' as const, target: { role: 'button', name: 'Delete expense' }, within: { role: 'dialog' as const, name: 'Delete expense', exact: true } },
    ];
    const parsed = AuthoredFragmentSchema.parse(fragment({ interfaces: [task({ steps })] }));
    expect(parsed.interfaces[0].steps).toEqual(steps);
    expect(validate(parsed).errors).toEqual([]);
  });
});


describe('supporting browser controls', () => {
  it('persists executable cancel branches and pagination alongside tasks', () => {
    const controls = ['cancel-add', 'cancel-edit', 'cancel-delete', 'previous-page', 'next-page'].map((id) => task({
      id: `web/${id}`, title: id, purpose: 'control', at: 'root',
      steps: [{ kind: 'activate', target: `button "${id}"` }],
    }))
    const result = validate(fragment({ interfaces: [task(), ...controls] }))
    expect(result.errors).toEqual([])
    expect(result.authored!.interfaces.filter((i) => i.purpose === 'control')).toHaveLength(5)
    expect(result.authored!.interfaces.every((i) => i.steps.length > 0)).toBe(true)
  })
})

/**
 * THE FOLD — what `check_draft` does with the piece a call carries. A draft is
 * built up across calls, so the fold is what "already accepted" means: an id it
 * re-sends corrects that entry, an id it omits is untouched, and a place is
 * merged the way the write path merges an enrichment.
 */
describe('folding one checked piece into the draft so far', () => {
  const second = task({ id: 'web/open-repository', title: 'Open a repository' })

  it('adds what a call carries and leaves the rest of the draft alone', () => {
    const folded = foldAuthoredFragment(fragment({ unresolved: ['no name on the icon button'] }), {
      interfaces: [second],
      unresolved: ['no name on the icon button', 'the toast has no role'],
    })
    expect(folded.interfaces.map((i) => i.id)).toEqual([task().id, second.id])
    // The repeated line is one line; the new one lands after it.
    expect(folded.unresolved).toEqual(['no name on the icon button', 'the toast has no role'])
  })

  it('replaces an entry a later call re-sends, keeping its place in the draft', () => {
    const corrected = task({ steps: [{ kind: 'activate', target: { role: 'link', name: 'Add' } }] })
    const folded = foldAuthoredFragment(
      foldAuthoredFragment(fragment(), { interfaces: [second] }),
      { interfaces: [corrected] },
    )
    expect(folded.interfaces.map((i) => i.id)).toEqual([task().id, second.id])
    expect(folded.interfaces[0].steps).toEqual(corrected.steps)
  })

  it('merges a place readable kind by kind, the way the write path does', () => {
    const folded = foldAuthoredFragment(
      fragment({
        resources: [
          { id: 'root', kind: 'screen', title: '/', address: '/', readables: { markers: [{ marker: 'No repositories yet' }] } },
        ],
      }),
      {
        interfaces: [],
        resources: [
          { id: 'root', kind: 'screen', title: '/', address: '/', readables: { elements: [{ element: { role: 'heading', name: 'Repositories' } }] } },
        ],
      },
    )
    expect(folded.resources).toHaveLength(1)
    expect(Object.keys(folded.resources![0].readables!).sort()).toEqual(['elements', 'markers'])
  })

  /**
   * A state names the world a task assumes or leaves, so one the draft's own
   * tasks no longer chain to is not part of the draft. That is what lets a
   * correction RENAME a world — the id the task left behind goes with it,
   * instead of riding along to the outcome and colliding with the registry.
   */
  it('keeps only the states the draft’s own tasks reference', () => {
    const base = foldAuthoredFragment(EMPTY_FRAGMENT, {
      interfaces: [task({ endState: 'repository-registered' })],
      states: [{ id: 'repository-registered', description: 'A repository is registered.' }],
    })
    expect(base.states!.map((s) => s.id)).toEqual(['repository-registered'])

    const renamed = foldAuthoredFragment(base, {
      interfaces: [task({ endState: 'listed-repository-registered' })],
      states: [{ id: 'listed-repository-registered', description: 'A repository is registered.' }],
    })
    expect(renamed.states!.map((s) => s.id)).toEqual(['listed-repository-registered'])
  })
})

describe("accounting for a screen's existing tasks", () => {
  const task = (id: string) => ({
    id, type: 'web' as const, title: id, entry: { method: 'GET', path: '/' },
    steps: [{ kind: 'navigate' as const, route: '/' }],
  })
  const prior = new Set(['web/a', 'web/b', 'web/c'])

  it('lets the fragment overwrite only what it amends or retires', () => {
    const result = accountForPrior(
      { interfaces: [task('web/a'), task('web/new')], kept: ['web/b'], retired: [{ id: 'web/c', reason: 'gone' }] },
      prior,
    )
    expect(result).toEqual({ replaceable: new Set(['web/a', 'web/c']), unaccounted: [], errors: [] })
  })

  it('names the tasks it never mentions', () => {
    expect(accountForPrior({ interfaces: [], kept: ['web/a'] }, prior).unaccounted).toEqual(['web/b', 'web/c'])
  })

  it('refuses a decision about a task that is not the screen\'s, and two decisions about one', () => {
    const { errors } = accountForPrior(
      { interfaces: [task('web/a')], kept: ['web/a', 'web/elsewhere'], retired: [{ id: 'web/a', reason: 'x' }] },
      prior,
    )
    expect(errors).toEqual([
      '`web/elsewhere` is not one of this screen\'s existing tasks — only those are kept or retired',
      '`web/a` is both kept and retired',
      '`web/a` is both kept and re-sent — re-send it only when it changed',
      '`web/a` is both retired and re-sent',
    ])
  })

  it('takes the latest word on a task across check_draft pieces', () => {
    const kept = foldAuthoredFragment({ interfaces: [] }, { interfaces: [], kept: ['web/a'] })
    const amended = foldAuthoredFragment(kept, { interfaces: [task('web/a')] })
    expect(amended.kept).toBeUndefined()
    expect(amended.interfaces.map((t) => t.id)).toEqual(['web/a'])
    const retired = foldAuthoredFragment(amended, { interfaces: [], retired: [{ id: 'web/a', reason: 'gone' }] })
    expect(retired.interfaces).toEqual([])
    expect(retired.retired).toEqual([{ id: 'web/a', reason: 'gone' }])
  })
})
