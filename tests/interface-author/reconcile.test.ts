/**
 * STATE RECONCILIATION — the pass that collapses the registry's synonyms after a
 * run whose sessions could not see each other (item 3).
 *
 * The model is a STUB throughout: what is under test is everything around it —
 * the deterministic collapse that needs no model at all, the guardrails that
 * drop one bad group without costing the good ones, the rewrite of every
 * reference, the proof that no fingerprint moves (which is what makes the whole
 * pass safe on a committed catalog), the refusal to write over a catalog whose
 * merge would not parse, and idempotence, which is the only thing standing in
 * for an alias table.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  reconcileAuthoredStates,
  reconcileStates,
  type ReconcileComplete,
} from '../../packages/interface-author/src/reconcile'
import { interfaceFingerprint, type Interface, type InterfacesFile } from '../../packages/shared/src/index'
import { guardAuthoredInterfacesPath, guardInterfacesPath } from '@truecourse/guard-runner'

// ---------------------------------------------------------------------------
// a catalog whose registry says one world three ways
// ---------------------------------------------------------------------------

const DERIVED: InterfacesFile = {
  version: 2,
  generatedAt: '2026-08-18T00:00:00.000Z',
  recipeFingerprint: 'sha256:recipe',
  interfaces: [],
  resources: {
    web: [
      { id: 'root', kind: 'screen', title: '/', address: '/' },
      { id: 'settings', kind: 'screen', title: '/settings', address: '/settings' },
    ],
  },
  source: { web: 'tree' },
}

function stamp(iface: Omit<Interface, 'fingerprint'>): Interface {
  return {
    ...iface,
    fingerprint: interfaceFingerprint({ type: iface.type, entry: iface.entry, steps: iface.steps }),
  } as Interface
}

function authoredCatalog(): InterfacesFile {
  return {
    version: 2,
    generatedAt: '2026-08-17T00:00:00.000Z',
    recipeFingerprint: 'sha256:recipe',
    interfaces: [
      stamp({
        id: 'web/create-document',
        type: 'web',
        title: 'Create a document',
        entry: { method: 'GET', path: '/' },
        steps: [
          { kind: 'input', target: 'textbox "Title"' },
          { kind: 'activate', target: 'button "Create"' },
        ],
        at: 'root',
        endState: 'document-created',
      }),
      stamp({
        id: 'web/rename-document',
        type: 'web',
        title: 'Rename a document',
        entry: { method: 'GET', path: '/' },
        steps: [
          { kind: 'input', target: 'textbox "Name"' },
          { kind: 'activate', target: 'button "Rename"' },
        ],
        at: 'root',
        startingState: 'document-exists',
        endState: 'document-saved',
      }),
      stamp({
        id: 'web/save-settings',
        type: 'web',
        title: 'Save the account settings',
        entry: { method: 'GET', path: '/settings' },
        steps: [{ kind: 'activate', target: 'button "Save"' }],
        at: 'settings',
        endState: 'settings-updated',
      }),
    ],
    states: {
      web: [
        { id: 'document-created', description: 'A document exists in the account.' },
        // Byte-identical to the one above up to case and the trailing period —
        // the deterministic half's job, no model involved.
        { id: 'document-exists', description: 'a document exists in the account' },
        // A synonym only a reader can see — the model half's job.
        { id: 'document-saved', description: 'The document is stored and listed on the home grid.' },
        { id: 'settings-updated', description: 'The account settings are saved.' },
      ],
    },
  }
}

/** A stub model that answers with the groups it was handed, and records the ask. */
function stubComplete(groups: unknown[]): ReconcileComplete & { asked: string[] } {
  const asked: string[] = []
  const complete = (async (prompt) => {
    asked.push(prompt.user)
    return { groups }
  }) as ReconcileComplete & { asked: string[] }
  complete.asked = asked
  return complete
}

describe('the deterministic half', () => {
  it('collapses ids whose descriptions say the same thing, with no model at all', async () => {
    const result = await reconcileStates({ derived: DERIVED, authored: authoredCatalog() })

    expect(result.status).toBe('reconciled')
    expect([result.before, result.after, result.merged]).toEqual([4, 3, 1])
    expect(result.merges).toEqual([{ keep: 'document-created', absorb: ['document-exists'] }])
    expect(result.authored!.states!.web!.map((s) => s.id)).toEqual([
      'document-created',
      'document-saved',
      'settings-updated',
    ])
    const renamed = result.authored!.interfaces.find((i) => i.id === 'web/rename-document')!
    expect(renamed.startingState).toBe('document-created')
    expect(renamed.endState).toBe('document-saved')
  })

  it('leaves a registry that already names each world once alone', async () => {
    const authored = authoredCatalog()
    authored.states!.web![1]!.description = 'A document is open in the editor.'
    const result = await reconcileStates({ derived: DERIVED, authored })

    expect(result.status).toBe('unchanged')
    expect([result.before, result.after, result.merged]).toEqual([4, 4, 0])
    expect(result.authored).toBeUndefined()
  })
})

describe('the model half', () => {
  it('collapses the synonyms one call names, and composes with the deterministic pass', async () => {
    const complete = stubComplete([
      {
        keep: 'document-created',
        absorb: ['document-saved'],
        description: 'A document exists in the account and is listed on the home grid.',
      },
    ])
    const result = await reconcileStates({ derived: DERIVED, authored: authoredCatalog(), complete })

    expect(result.status).toBe('reconciled')
    expect([result.before, result.after, result.merged]).toEqual([4, 2, 2])
    // The ids the deterministic pass already absorbed are never put to the model.
    expect(complete.asked[0]).not.toContain('document-exists')
    expect(complete.asked[0]).toContain('document-saved')

    const states = result.authored!.states!.web!
    expect(states.map((s) => s.id)).toEqual(['document-created', 'settings-updated'])
    expect(states[0]!.description).toBe(
      'A document exists in the account and is listed on the home grid.',
    )
    const renamed = result.authored!.interfaces.find((i) => i.id === 'web/rename-document')!
    // Both ends chained through ids that no longer exist; both now name the survivor.
    expect(renamed.startingState).toBe('document-created')
    expect(renamed.endState).toBe('document-created')
  })

  it('drops an invalid group on its own and keeps the good ones', async () => {
    const complete = stubComplete([
      { keep: 'no-such-state', absorb: ['document-saved'] },
      { keep: 'document-saved', absorb: ['document-saved'] },
      { keep: 'document-created', absorb: ['document-saved'] },
      { keep: 'settings-updated', absorb: ['document-saved'] },
    ])
    const result = await reconcileStates({ derived: DERIVED, authored: authoredCatalog(), complete })

    expect(result.status).toBe('reconciled')
    expect(result.merges).toEqual([
      { keep: 'document-created', absorb: ['document-exists'] },
      { keep: 'document-created', absorb: ['document-saved'] },
    ])
    expect(result.dropped).toHaveLength(3)
    expect(result.dropped[0]).toContain('no such state')
    expect(result.dropped[1]).toContain('absorbs itself')
    expect(result.dropped[2]).toContain('already grouped')
  })

  it('keeps the deterministic collapse when the call itself fails', async () => {
    const complete: ReconcileComplete = async () => {
      throw new Error('overloaded')
    }
    const result = await reconcileStates({ derived: DERIVED, authored: authoredCatalog(), complete })

    expect(result.status).toBe('reconciled')
    expect(result.merged).toBe(1)
    expect(result.problems[0]).toContain('overloaded')
  })

  it('reports a reply that does not match its schema and merges nothing extra', async () => {
    const complete = stubComplete([{ keep: 'document-created' }])
    const result = await reconcileStates({ derived: DERIVED, authored: authoredCatalog(), complete })

    expect(result.merged).toBe(1)
    expect(result.problems[0]).toContain('did not match its schema')
  })
})

describe('what the rewrite must never move', () => {
  it('moves no interface fingerprint — a state is not part of what a task IS', async () => {
    const before = authoredCatalog()
    const complete = stubComplete([{ keep: 'document-created', absorb: ['document-saved'] }])
    const result = await reconcileStates({ derived: DERIVED, authored: before, complete })

    const after = result.authored!.interfaces
    expect(after.map((i) => i.fingerprint)).toEqual(before.interfaces.map((i) => i.fingerprint))
    for (const iface of after) {
      expect(iface.fingerprint).toBe(
        interfaceFingerprint({ type: iface.type, entry: iface.entry, steps: iface.steps }),
      )
    }
  })

  it('refuses the whole reconciliation when the merged catalog would not parse', async () => {
    const authored = authoredCatalog()
    // A reference nothing defines — the rewrite cannot invent it, and a pass that
    // wrote anyway would commit a catalog no consumer can read.
    authored.interfaces[2] = { ...authored.interfaces[2]!, endState: 'ghost-state' }
    const result = await reconcileStates({ derived: DERIVED, authored })

    expect(result.status).toBe('rejected')
    expect([result.before, result.after, result.merged]).toEqual([4, 4, 0])
    expect(result.authored).toBeUndefined()
    expect(result.problems.join('\n')).toContain('ghost-state')
  })
})

describe('over the store', () => {
  let repo: string
  const now = () => '2026-08-18T12:00:00.000Z'

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-iface-reconcile-'))
    fs.mkdirSync(path.dirname(guardInterfacesPath(repo)), { recursive: true })
    fs.writeFileSync(guardInterfacesPath(repo), JSON.stringify(DERIVED))
    fs.writeFileSync(guardAuthoredInterfacesPath(repo), JSON.stringify(authoredCatalog()))
  })

  it('writes the reconciled catalog and re-reconciles to itself', async () => {
    const groups = [{ keep: 'document-created', absorb: ['document-saved'] }]

    const first = await reconcileAuthoredStates({ repoRoot: repo, complete: stubComplete(groups), now })
    expect(first.status).toBe('reconciled')
    expect(first.path).toBe(guardAuthoredInterfacesPath(repo))
    const written = fs.readFileSync(guardAuthoredInterfacesPath(repo), 'utf-8')

    // The same stub answers again with a group whose ids are gone: nothing more
    // collapses, nothing is written, and the file is byte-for-byte what it was.
    const second = await reconcileAuthoredStates({ repoRoot: repo, complete: stubComplete(groups), now })
    expect(second.status).toBe('unchanged')
    expect([second.before, second.after, second.merged]).toEqual([2, 2, 0])
    expect(fs.readFileSync(guardAuthoredInterfacesPath(repo), 'utf-8')).toBe(written)
  })

  it('leaves the file untouched when the reconciliation is rejected', async () => {
    const broken = authoredCatalog()
    broken.interfaces[2] = { ...broken.interfaces[2]!, endState: 'ghost-state' }
    fs.writeFileSync(guardAuthoredInterfacesPath(repo), JSON.stringify(broken))
    const before = fs.readFileSync(guardAuthoredInterfacesPath(repo), 'utf-8')

    const result = await reconcileAuthoredStates({ repoRoot: repo, now })

    expect(result.status).toBe('rejected')
    expect(result.path).toBeUndefined()
    expect(fs.readFileSync(guardAuthoredInterfacesPath(repo), 'utf-8')).toBe(before)
  })

  it('reads a repository with nothing authored as nothing to reconcile', async () => {
    fs.rmSync(guardAuthoredInterfacesPath(repo))
    const result = await reconcileAuthoredStates({ repoRoot: repo, now })

    expect(result.status).toBe('unchanged')
    expect([result.before, result.after, result.merged]).toEqual([0, 0, 0])
  })
})
