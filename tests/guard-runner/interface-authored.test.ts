/**
 * THE AUTHORED CATALOG — `guard/interfaces.authored.json`, the committed half of
 * the interface catalog, merged over the derived snapshot at READ time.
 *
 * The failure this exists to stop: the mapper derives `cli` and `api` and NOTHING
 * else, yet every web surface in existence is hand-authored, and it lived in the
 * derived file — so one `map` deleted it and every flow that grounded on it
 * settled as `no-interface`. The authored file is a second, committed home the
 * derivation never writes; the merge is what puts the two halves back together.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  guardAuthoredInterfacesPath,
  guardInterfacesPath,
  mergeInterfaceCatalogs,
  readAuthoredInterfaceCatalog,
  readMergedInterfaceCatalog,
} from '@truecourse/guard-runner'
import { interfaceFingerprint, type Interface, type InterfacesFile } from '@truecourse/shared'

let repo: string

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-authored-'))
})

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true })
})

function iface(over: Partial<Interface> & Pick<Interface, 'id' | 'type'>): Interface {
  const base = {
    title: over.title ?? over.id,
    entry: over.entry ?? { command: [over.id.split('/')[1]!] },
    steps: over.steps ?? [{ kind: 'invoke' as const, command: [over.id.split('/')[1]!], flags: [] }],
    ...over,
  }
  return { ...base, fingerprint: interfaceFingerprint(base) } as Interface
}

function catalog(over: Partial<InterfacesFile> = {}): InterfacesFile {
  return {
    version: 2,
    generatedAt: '2026-08-17T00:00:00.000Z',
    recipeFingerprint: 'sha256:recipe',
    interfaces: [],
    ...over,
  } as InterfacesFile
}

function writeDerived(file: InterfacesFile): void {
  const target = guardInterfacesPath(repo)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(file, null, 2))
}

function writeAuthored(file: unknown): void {
  const target = guardAuthoredInterfacesPath(repo)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(file, null, 2))
}

const WEB = iface({
  id: 'web/silence-rule',
  type: 'web',
  title: 'silence a rule',
  entry: { command: ['open', 'rules'] },
  steps: [{ kind: 'navigate', route: '/repos/1' }],
})

describe('the authored catalog', () => {
  it('is absent by default — nothing authored is the normal state, never an error', () => {
    expect(readAuthoredInterfaceCatalog(repo)).toBeNull()
    expect(readMergedInterfaceCatalog(repo)).toBeNull()
    expect(guardAuthoredInterfacesPath(repo)).toBe(
      path.join(repo, '.truecourse', 'guard', 'interfaces.authored.json'),
    )
  })

  it('reads through the SAME schema as the derived file — one shape, two homes', () => {
    writeAuthored(catalog({ interfaces: [WEB], resources: { web: [{ id: 'rules-dialog', kind: 'dialog', title: 'the Rules dialog' }] } }))
    expect(readAuthoredInterfaceCatalog(repo)?.interfaces.map((j) => j.id)).toEqual(['web/silence-rule'])
  })

  it('refuses a present-but-unreadable authored file rather than reading it as empty', () => {
    // The whole point of the file is that an authored surface can never be lost
    // quietly. Degrading a corrupt one to "nothing authored" would reproduce
    // exactly the silence this design removes.
    fs.mkdirSync(path.dirname(guardAuthoredInterfacesPath(repo)), { recursive: true })
    fs.writeFileSync(guardAuthoredInterfacesPath(repo), '{ not json')
    expect(() => readAuthoredInterfaceCatalog(repo)).toThrow(/interfaces\.authored\.json/)
  })

  it('stamps every interface with where it came from', () => {
    writeDerived(catalog({ interfaces: [iface({ id: 'cli/add', type: 'cli' })], source: { cli: 'tree' } }))
    writeAuthored(catalog({ interfaces: [WEB] }))

    const merged = readMergedInterfaceCatalog(repo)!
    expect(merged.interfaces.map((j) => [j.id, j.origin])).toEqual([
      ['cli/add', 'derived'],
      ['web/silence-rule', 'authored'],
    ])
  })

  it('takes the authored entry outright when both name the same id', () => {
    const derived = iface({ id: 'api/get-todos', type: 'api', title: 'GET /todos', entry: { method: 'GET', path: '/todos' }, steps: [{ kind: 'request', method: 'GET', path: '/todos' }] })
    const authored = { ...derived, title: 'list every todo', group: 'todos' }
    writeDerived(catalog({ interfaces: [iface({ id: 'cli/add', type: 'cli' }), derived] }))
    writeAuthored(catalog({ interfaces: [authored] }))

    const merged = readMergedInterfaceCatalog(repo)!
    // Replaced in place: the derived list's order is the catalog's order, so an
    // override never reshuffles what a reader is looking at.
    expect(merged.interfaces.map((j) => j.id)).toEqual(['cli/add', 'api/get-todos'])
    const won = merged.interfaces[1]!
    expect(won.title).toBe('list every todo')
    expect(won.group).toBe('todos')
    expect(won.origin).toBe('authored')
  })

  it('never adopts the authored file’s own source claim — source says how a surface was DERIVED', () => {
    // The mislabel that hid this failure for months: a 100% hand-written catalog
    // claiming `{"api":"tree","web":"tree"}`. The merged view recomputes nothing
    // from the authored side, so a surface nobody derived claims no derivation.
    writeDerived(catalog({ interfaces: [iface({ id: 'cli/add', type: 'cli' })], source: { cli: 'probes' } }))
    writeAuthored(catalog({ interfaces: [WEB], source: { web: 'tree', cli: 'tree' } }))

    expect(readMergedInterfaceCatalog(repo)!.source).toEqual({ cli: 'probes' })
  })

  it('merges the registries per area, by id, authored winning', () => {
    writeDerived(
      catalog({
        interfaces: [iface({ id: 'cli/add', type: 'cli', resource: 'tasks' })],
        resources: {
          cli: [
            { id: 'tasks', kind: 'command-group', title: 'tasks' },
            { id: 'config', kind: 'command-group', title: 'config' },
          ],
        },
      }),
    )
    writeAuthored(
      catalog({
        interfaces: [WEB],
        resources: {
          cli: [{ id: 'tasks', kind: 'command-group', title: 'the tasks command tree' }],
          web: [{ id: 'rules-dialog', kind: 'dialog', title: 'the Rules dialog' }],
        },
        states: { web: [{ id: 'rule-silenced', description: 'a rule is silenced' }] },
      }),
    )

    const merged = readMergedInterfaceCatalog(repo)!
    // Same area, same id: the authored definition replaces the derived one in place.
    expect(merged.resources!.cli).toEqual([
      { id: 'tasks', kind: 'command-group', title: 'the tasks command tree' },
      { id: 'config', kind: 'command-group', title: 'config' },
    ])
    // An area only the authored file names arrives whole.
    expect(merged.resources!.web!.map((r) => r.id)).toEqual(['rules-dialog'])
    // The state registry travels too, or the ids an authored task names resolve
    // to nothing on the other side of the merge.
    expect(merged.states!.web!.map((s) => s.id)).toEqual(['rule-silenced'])
  })

  it('merges one-sided in both directions', () => {
    writeAuthored(catalog({ interfaces: [WEB] }))
    const authoredOnly = readMergedInterfaceCatalog(repo)!
    expect(authoredOnly.interfaces.map((j) => j.origin)).toEqual(['authored'])
    expect(authoredOnly.source).toBeUndefined()

    fs.rmSync(guardAuthoredInterfacesPath(repo))
    writeDerived(catalog({ interfaces: [iface({ id: 'cli/add', type: 'cli' })], source: { cli: 'tree' } }))
    const derivedOnly = readMergedInterfaceCatalog(repo)!
    expect(derivedOnly.interfaces.map((j) => j.origin)).toEqual(['derived'])
    expect(derivedOnly.source).toEqual({ cli: 'tree' })
  })

  it('is a pure fold a caller can run over two catalogs it already holds', () => {
    const merged = mergeInterfaceCatalogs(
      catalog({ interfaces: [iface({ id: 'cli/add', type: 'cli' })] }),
      catalog({ interfaces: [WEB], generatedAt: '2020-01-01T00:00:00.000Z' }),
    )
    expect(merged.interfaces.map((j) => j.id)).toEqual(['cli/add', 'web/silence-rule'])
    // The envelope is the DERIVED run's: when the mapping ran, and what recipe it
    // ran against. The authored file is not a mapping and dates nothing.
    expect(merged.generatedAt).toBe('2026-08-17T00:00:00.000Z')
    expect(mergeInterfaceCatalogs(null, null).interfaces).toEqual([])
  })
})
