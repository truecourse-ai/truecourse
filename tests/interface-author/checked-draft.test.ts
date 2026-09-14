import { describe, expect, it } from 'vitest'
import { runAgentLoop, SessionEventBodySchema, type SessionDriver, type SessionEvent, type SessionPersistence } from '../../packages/agent-loop/src/index'
import { checkedDraftEvidence, resolveCheckedDraft } from '../../packages/core/src/services/interface-author/checked-draft'
import { interfaceAuthorSessionDef } from '../../packages/core/src/services/interface-author/session'

const fragment = { interfaces: [], unresolved: ['No controls on this screen.'] }
const evidence = checkedDraftEvidence(fragment)
const checked: SessionEvent = { type: 'tool-result', toolName: 'check_draft', content: 'valid', artifact: evidence, seq: 0, ts: '2026-09-14T00:00:00Z' }

describe('checked authoring draft references', () => {
  it('resolves durable evidence and rejects missing, failed, or tampered evidence', () => {
    expect(SessionEventBodySchema.parse(checked)).toHaveProperty('artifact', evidence)
    expect(resolveCheckedDraft({ draftId: evidence.draftId }, [checked])).toEqual(fragment)
    expect(() => resolveCheckedDraft({ draftId: evidence.draftId }, [])).toThrow('unavailable')
    expect(() => resolveCheckedDraft({ draftId: evidence.draftId }, [{ ...checked, isError: true }])).toThrow('unavailable')
    expect(() => resolveCheckedDraft({ draftId: evidence.draftId }, [{ ...checked, artifact: { ...evidence, fragment: { interfaces: [] } } }])).toThrow('unavailable')
  })

  it('keeps full outcomes from older transcripts compatible', () => {
    expect(resolveCheckedDraft(fragment, [])).toEqual(fragment)
  })

  it('restores a checked draft on resume and runs live validation before recording full output', async () => {
    const events = new Map<string, SessionEvent[]>([['prior', [checked]]])
    const persistence: SessionPersistence = {
      readEvents: id => events.get(id) ?? [],
      appendEvent(id, event) { events.set(id, [...(events.get(id) ?? []), event]) },
      updateIndex() {},
    }
    const def = interfaceAuthorSessionDef({ repoRoot: '/unused', derived: null, authored: null, replaceable: new Set() })
    let attempts = 0
    let validations = 0
    def.validateOutcome = draft => {
      expect(draft).toEqual(fragment)
      return ++validations === 1 ? 'Catalog changed; review the conflict.' : undefined
    }
    const driver: SessionDriver = {
      capabilities: { steering: 'turn-boundary', structuredOutcome: 'tool', resumeAtMessage: false },
      attribution: { provider: 'test', model: 'test' },
      runSession(input) {
        expect(input.def.outcomeInputSchema?.safeParse({ draftId: evidence.draftId }).success).toBe(true)
        if (++attempts === 2) expect(input.initialMessages).toContain('Catalog changed; review the conflict.')
        return { status: () => 'running', steer() {}, interrupt: async () => {}, done: Promise.resolve({ kind: 'outcome', value: { draftId: evidence.draftId } }) }
      },
    }
    const result = await runAgentLoop({ def, workItem: 'web:root', initialMessages: [], driver, persistence, sessionId: 'current', resume: { of: 'prior' } }).outcome
    expect(result.status).toBe('completed')
    expect(validations).toBe(2)
    expect(events.get('current')?.find(e => e.type === 'outcome')).toMatchObject({ value: fragment })
    expect(resolveCheckedDraft({ draftId: evidence.draftId }, [checked])).not.toBe(evidence.fragment)
  })
})
