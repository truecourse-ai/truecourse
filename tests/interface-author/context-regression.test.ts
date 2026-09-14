import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { InterfacesFile } from '@truecourse/shared'
import { clusterPack } from '../../packages/core/src/services/interface-author/pack'
import { placeSourcePack } from '../../packages/core/src/services/interface-author/place-pack'
import { ownTaskContext } from '../../packages/core/src/services/interface-author/catalog-context'
import { interfaceAuthorSessionDef, placeBriefing } from '../../packages/core/src/services/interface-author/session'

const repo = path.resolve('tests/fixtures/interface-context')
const screens = [
  { id: 'expenses', kind: 'screen' as const, title: 'Expenses', address: '/expenses' },
  { id: 'expense-detail', kind: 'screen' as const, title: 'Expense details', address: '/expenses/{id}' },
]
const dialogs = screens.map(screen => ({ id: `${screen.id}-delete`, kind: 'dialog' as const, title: 'Delete expense', of: screen.id }))
const states = [{ id: 'expense-present', description: 'The expense still exists.' }]
const derived: InterfacesFile = {
  version: 2, generatedAt: '', recipeFingerprint: '', interfaces: [],
  resources: { web: [...screens, ...dialogs] }, states: { web: states },
}

describe('combined interface context regression', () => {
  it('supplies a late dialog control once and validates it under each screen owner', async () => {
    const shared = clusterPack(repo, { id: 'cluster/expenses', places: screens.map(s => s.id), shared: ['DeleteDialog.tsx'] })!
    expect(shared.text).toContain('onClick={onCancel}>Cancel</button>')
    const totals: number[] = []
    for (const [index, screen] of screens.entries()) {
      const context = { module: index ? 'ExpenseDetail.tsx' : 'Expenses.tsx', renders: ['DeleteDialog.tsx'], closure: 2, apiEffects: [], rpcCalls: [], unjoined: [] }
      const source = placeSourcePack(repo, context, shared.modules)!
      const tasks = ownTaskContext({ derived, authored: null, screenId: screen.id, replace: false })
      const briefing = placeBriefing({ place: screen, existing: [], states, screens, nested: [dialogs[index]], context, ownTaskContext: tasks, sourcePack: source.text })
      const def = interfaceAuthorSessionDef({ repoRoot: repo, derived, authored: null, replaceable: new Set(), scope: { screenId: screen.id, address: screen.address } })
      const opening = {
        system: Buffer.byteLength(def.systemPrompt), shared: shared.bytes,
        source: source.bytes, tasks: Buffer.byteLength(tasks),
        otherBriefing: Buffer.byteLength(briefing) - source.bytes - Buffer.byteLength(tasks),
      }
      totals.push(Object.values(opening).reduce((sum, bytes) => sum + bytes, 0))
      expect(opening.source).toBeLessThanOrEqual(24_000)
      expect(opening.tasks).toBeLessThanOrEqual(12_000)
      expect(opening.shared).toBeLessThanOrEqual(60_000)
      expect(briefing).not.toContain('onClick={onCancel}')
      expect(source.entries.map(e => e.status)).toEqual(['complete', 'shared-complete'])
      const fragment = {
        interfaces: [{
          id: `web/cancel-delete-${screen.id}`, type: 'web', purpose: 'control', title: 'Cancel expense deletion',
          entry: { method: 'GET', path: screen.address }, at: dialogs[index].id, to: screen.id,
          startingState: 'expense-present', endState: 'expense-present',
          steps: [{ kind: 'activate', target: 'button "Cancel"', within: { role: 'dialog', name: 'Delete expense', exact: true } }],
        }],
      }
      const tool = def.tools.find(tool => tool.name === 'check_draft')!
      const result = await tool.execute(tool.inputSchema.parse(fragment), { workItem: screen.id, signal: new AbortController().signal, dispatchChild: async () => { throw new Error('unused') } })
      expect(result.isError, result.content).toBeUndefined()
      expect(result.content).toContain('The draft is valid')
      const wrongOwner = structuredClone(fragment)
      wrongOwner.interfaces[0].at = dialogs[1 - index].id
      expect((await tool.execute(tool.inputSchema.parse(wrongOwner), { workItem: screen.id, signal: new AbortController().signal, dispatchChild: async () => { throw new Error('unused') } })).isError).toBe(true)
    }
    expect(totals.every(total => total > shared.bytes)).toBe(true)
  })
})
