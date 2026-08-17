/**
 * THE AUTHORING CONTEXT PACK — the three facts an authoring session is handed
 * about a place instead of rediscovering (SPEC_GUARD_PLAN item 105).
 *
 * The tests that matter here are the ones about RESTRAINT. A closure that
 * follows every edge of a design-system barrel buys two hundred modules and
 * names none of the ones that render the screen; a join that attributes every
 * request in a shared api client hangs its whole endpoint list on every screen
 * that imports one function from it. Both are the failure modes that make a
 * context pack worse than no context pack, and both have a rule pinned below.
 */

import { describe, it, expect } from 'vitest'
import { deriveWebPlaceContexts } from '../../packages/interface-mapper/src/web-context'
import type { WebPlace } from '../../packages/interface-mapper/src/web-tree'
import { interfaceFingerprint, type Interface } from '../../packages/shared/src/interfaces'
import type { FileAnalysis, ModuleDependency } from '../../packages/shared/src/index'

const ROOT = '/r'

interface FileSpec {
  /** Functions as `name:startLine-endLine`. */
  functions?: string[]
  /** Class methods as `Class.method:startLine-endLine`. */
  methods?: string[]
  /** Http calls as `METHOD url@line`. */
  http?: string[]
  /** Call expressions as `callee@line`. */
  calls?: string[]
  /** Re-exported names — a file whose exports are ALL re-exports is a barrel. */
  reexports?: string[]
}

function file(path: string, spec: FileSpec = {}): FileAnalysis {
  return {
    filePath: `${ROOT}/${path}`,
    language: path.endsWith('x') ? 'tsx' : 'typescript',
    functions: (spec.functions ?? []).map((entry) => {
      const [name, range] = entry.split(':')
      const [startLine, endLine] = range.split('-').map(Number)
      return {
        name,
        params: [],
        isAsync: false,
        isExported: true,
        location: { filePath: `${ROOT}/${path}`, startLine, endLine, startColumn: 0, endColumn: 0 },
      }
    }),
    classes: classesOf(path, spec.methods ?? []),
    imports: [],
    exports: (spec.reexports ?? []).map((name) => ({ name, isDefault: false, source: './somewhere' })),
    calls: (spec.calls ?? []).map((entry) => {
      const [callee, line] = entry.split('@')
      return {
        callee,
        location: {
          filePath: `${ROOT}/${path}`,
          startLine: Number(line),
          endLine: Number(line),
          startColumn: 0,
          endColumn: 0,
        },
      }
    }),
    httpCalls: (spec.http ?? []).map((entry) => {
      const [call, line] = entry.split('@')
      const [method, url] = call.split(' ')
      return {
        method: method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
        url,
        location: {
          filePath: `${ROOT}/${path}`,
          startLine: Number(line),
          endLine: Number(line),
          startColumn: 0,
          endColumn: 0,
        },
      }
    }),
  }
}

function classesOf(path: string, methods: string[]): FileAnalysis['classes'] {
  const byClass = new Map<string, FileAnalysis['classes'][number]['methods']>()
  for (const entry of methods) {
    const [qualified, range] = entry.split(':')
    const [className, methodName] = qualified.split('.')
    const [startLine, endLine] = range.split('-').map(Number)
    const list = byClass.get(className) ?? []
    list.push({
      name: methodName,
      params: [],
      isAsync: false,
      isStatic: false,
      visibility: 'public',
      location: { filePath: `${ROOT}/${path}`, startLine, endLine, startColumn: 0, endColumn: 0 },
    })
    byClass.set(className, list)
  }
  return [...byClass.entries()].map(([name, methods]) => ({
    name,
    methods,
    properties: [],
    isExported: true,
    location: { filePath: `${ROOT}/${path}`, startLine: 1, endLine: 999, startColumn: 0, endColumn: 0 },
  }))
}

/** `page.tsx -> view.tsx {Button,List}` */
function edge(spec: string): ModuleDependency {
  const [pair, names] = spec.split(' {')
  const [source, target] = pair.split(' -> ')
  return {
    source: `${ROOT}/${source}`,
    target: `${ROOT}/${target}`,
    importedNames: names ? names.replace('}', '').split(',').filter(Boolean) : [],
  }
}

function api(method: string, path: string): Interface {
  const entry = { method, path }
  const steps: Interface['steps'] = [{ kind: 'request', method, path }]
  return {
    id: `api/${method.toLowerCase()}${path.replace(/[^a-zA-Z0-9]+/g, '-')}`,
    type: 'api',
    title: `${method} ${path}`,
    entry,
    steps,
    fingerprint: interfaceFingerprint({ type: 'api', entry, steps }),
  }
}

function place(address: string, path: string): WebPlace {
  return { kind: 'screen', address, idiom: 'next-app', filePath: `${ROOT}/${path}` }
}

function derive(
  seeds: Record<string, WebPlace>,
  fileAnalyses: FileAnalysis[],
  dependencies: ModuleDependency[],
  apiInterfaces: Interface[] = [],
  depth?: number,
) {
  return deriveWebPlaceContexts({
    repoRoot: ROOT,
    seeds: new Map(Object.entries(seeds)),
    fileAnalyses,
    dependencies,
    apiInterfaces,
    ...(depth !== undefined ? { depth } : {}),
  })
}

describe('the route module (tier 1)', () => {
  it('carries the module the place was minted from, repo-relative', () => {
    const contexts = derive(
      { availability: place('/availability', 'apps/web/app/availability/page.tsx') },
      [file('apps/web/app/availability/page.tsx')],
      [],
    )
    expect(contexts.get('availability')?.module).toBe('apps/web/app/availability/page.tsx')
  })

  it('states nothing for a place whose module was never analyzed', () => {
    // The honest degradation: no entry at all, so the session is briefed exactly
    // as it was before the pack existed rather than told a file that is not there.
    const contexts = derive({ ghost: place('/ghost', 'apps/web/gone.tsx') }, [file('apps/web/other.tsx')], [])
    expect(contexts.has('ghost')).toBe(false)
  })
})

describe('the component closure (tier 2)', () => {
  it('walks the import graph and names the views, the screen’s own feature first', () => {
    const contexts = derive(
      { availability: place('/availability', 'app/availability/page.tsx') },
      [
        file('app/availability/page.tsx'),
        file('app/shell.tsx'),
        file('modules/availability/availability-view.tsx'),
        file('features/schedules/ScheduleListItem.tsx'),
        file('lib/dates.ts'),
      ],
      [
        edge('app/availability/page.tsx -> app/shell.tsx {Shell}'),
        edge('app/availability/page.tsx -> modules/availability/availability-view.tsx {AvailabilityView}'),
        edge('modules/availability/availability-view.tsx -> features/schedules/ScheduleListItem.tsx {ScheduleListItem}'),
        edge('modules/availability/availability-view.tsx -> lib/dates.ts {format}'),
      ],
    )
    const context = contexts.get('availability')!
    // `availability-view` carries the address's own word, so it leads; `lib/dates.ts`
    // is in the closure (the join needs it) but is not a view and is not named.
    expect(context.renders).toEqual([
      'modules/availability/availability-view.tsx',
      'app/shell.tsx',
      'features/schedules/ScheduleListItem.tsx',
    ])
    expect(context.closure).toBe(5)
  })

  it('stops at the requested depth', () => {
    const contexts = derive(
      { root: place('/', 'a.tsx') },
      [file('a.tsx'), file('b.tsx'), file('c.tsx')],
      [edge('a.tsx -> b.tsx {B}'), edge('b.tsx -> c.tsx {C}')],
      [],
      1,
    )
    expect(contexts.get('root')?.renders).toEqual(['b.tsx'])
  })

  it('survives a cycle', () => {
    const contexts = derive(
      { root: place('/', 'a.tsx') },
      [file('a.tsx'), file('b.tsx')],
      [edge('a.tsx -> b.tsx {B}'), edge('b.tsx -> a.tsx {A}')],
    )
    expect(contexts.get('root')?.closure).toBe(2)
  })

  it('follows a barrel only for the names the importer asked for', () => {
    // The measured explosion: one `import { Button } from '@ui'` against an index
    // that re-exports the whole design system. Following every edge names none of
    // the modules that render the screen; following the ASKED-FOR name names one.
    const contexts = derive(
      { root: place('/', 'page.tsx') },
      [
        file('page.tsx'),
        file('ui/index.ts', { reexports: ['Button', 'Table', 'Modal'] }),
        file('ui/button.tsx'),
        file('ui/table.tsx'),
        file('ui/modal.tsx'),
      ],
      [
        edge('page.tsx -> ui/index.ts {Button}'),
        edge('ui/index.ts -> ui/button.tsx {Button}'),
        edge('ui/index.ts -> ui/table.tsx {Table}'),
        edge('ui/index.ts -> ui/modal.tsx {Modal}'),
      ],
    )
    // The barrel itself is in the closure but never named: a re-export declares
    // no control.
    expect(contexts.get('root')?.renders).toEqual(['ui/button.tsx'])
    expect(contexts.get('root')?.closure).toBe(3)
  })
})

describe('the frontend→API join (tier 3)', () => {
  const catalog = [api('GET', '/v2/schedules'), api('POST', '/v2/schedules'), api('DELETE', '/v2/schedules/{id}')]

  it('joins a request in the place’s own module to the api interface it calls', () => {
    const contexts = derive(
      { schedules: place('/schedules', 'page.tsx') },
      [file('page.tsx', { http: ['POST /api/v2/schedules@10'] })],
      [],
      catalog,
    )
    // The frontend writes the mount prefix the route table does not, so a
    // segment-aligned tail is a match.
    expect(contexts.get('schedules')?.apiEffects).toEqual(['api/post-v2-schedules'])
    expect(contexts.get('schedules')?.unjoined).toEqual([])
  })

  it('resolves the parameter slot however the source spells it', () => {
    const contexts = derive(
      { schedules: place('/schedules', 'page.tsx') },
      [file('page.tsx', { http: ['DELETE `${base}/v2/schedules/${id}`@4'] })],
      [],
      catalog,
    )
    expect(contexts.get('schedules')?.apiEffects).toEqual([api('DELETE', '/v2/schedules/{id}').id])
  })

  it('attributes a wrapper’s request only when the closure imported it BY NAME', () => {
    // The shared-client rule: a page importing `createSchedule` from a client with
    // twenty endpoints gets that one endpoint, not the client's whole surface.
    const contexts = derive(
      { schedules: place('/schedules', 'page.tsx') },
      [
        file('page.tsx'),
        file('lib/client.ts', {
          functions: ['createSchedule:5-9', 'deleteSchedule:11-15'],
          http: ['POST /v2/schedules@6', 'DELETE /v2/schedules/{id}@12'],
        }),
      ],
      [edge('page.tsx -> lib/client.ts {createSchedule}')],
      catalog,
    )
    expect(contexts.get('schedules')?.apiEffects).toEqual(['api/post-v2-schedules'])
  })

  it('attributes a class method’s request when the class was imported', () => {
    const contexts = derive(
      { schedules: place('/schedules', 'page.tsx') },
      [
        file('page.tsx'),
        file('lib/client.ts', { methods: ['ApiClient.list:5-9'], http: ['GET /v2/schedules@6'] }),
      ],
      [edge('page.tsx -> lib/client.ts {ApiClient}')],
      catalog,
    )
    expect(contexts.get('schedules')?.apiEffects).toEqual(['api/get-v2-schedules'])
  })

  it('records a request no api interface declares, and never guesses one', () => {
    const contexts = derive(
      { schedules: place('/schedules', 'page.tsx') },
      [file('page.tsx', { http: ['POST /v3/tokens@3'] })],
      [],
      catalog,
    )
    const context = contexts.get('schedules')!
    expect(context.apiEffects).toEqual([])
    expect(context.unjoined).toEqual(['POST /v3/tokens — no api interface declares it'])
  })

  it('records a URL the source builds at runtime, and ignores what is not a URL at all', () => {
    const contexts = derive(
      { root: place('/', 'page.tsx') },
      // `cache.get(cacheKey)` reaches the analyzer's http matcher by callee shape;
      // reporting it as a request nobody could name would be inventing a request.
      [file('page.tsx', { http: ['GET `${endpoint}`@3', 'GET cacheKey@4'] })],
      [],
      catalog,
    )
    expect(contexts.get('root')?.unjoined).toEqual([
      'GET `${endpoint}` — the request URL is built at runtime',
    ])
  })

  it('names the tRPC procedures a screen calls, and keeps them out of apiEffects', () => {
    // documenso and cal.diy both talk tRPC, so this is the join's whole result
    // there: a procedure has no api interface behind it, and saying so is what
    // stops a session guessing ids it will never find.
    const contexts = derive(
      { 'settings-tokens': place('/settings/tokens', 'page.tsx') },
      [
        file('page.tsx', { calls: ['trpc.apiToken.getMany.useQuery@8'] }),
        file('dialogs/create.tsx', {
          functions: ['TokenCreateDialog:20-99'],
          calls: ['trpc.apiToken.create.useMutation@30', 'toast.success@40'],
        }),
      ],
      [edge('page.tsx -> dialogs/create.tsx {TokenCreateDialog}')],
      catalog,
    )
    const context = contexts.get('settings-tokens')!
    expect(context.rpcCalls).toEqual(['trpc.apiToken.create', 'trpc.apiToken.getMany'])
    expect(context.apiEffects).toEqual([])
  })
})
