import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getCacheEntry, setCacheEntry } from '@truecourse/llm'
import { GuardWebStepSchema, type GuardEvidenceProofContext } from '@truecourse/shared'
import type { WorkerFidelityInput } from '@truecourse/guard-generator'
import { runAgentLoop, type ToolContext } from '../../packages/agent-loop/src/index'
import { emptyFidelityTally, fidelitySessionCacheKey, fidelitySessionDef, FIDELITY_SESSION_CACHE_NAME,
  judgeWorkerFidelity } from '../../packages/core/src/services/guard-generate/fidelity'
import { buildGuardDocUniverse } from '../../packages/core/src/services/guard-generate/tools'
import { memoryPersistence, outcome, stubDriver, type StubCall } from './spec-scan-session-stub'
import { correctedEmptyLedgerEvidence, emptyLedgerEvidenceContext, invalidEmptyLedgerEvidence } from '../fixtures/guard-completion/empty-ledger-evidence'

const repos: string[] = []
afterEach(() => { while (repos.length) fs.rmSync(repos.pop()!, { recursive: true, force: true }) })
const universe = buildGuardDocUniverse([])
const faithful = (evidence = correctedEmptyLedgerEvidence) => ({ verdict: 'faithful' as const, evidence })
function input(proofContext = emptyLedgerEvidenceContext): WorkerFidelityInput {
  return { flowFingerprint: 'empty-ledger-flow', sectionKeys: ['empty-ledger-section'], scenarioBehavior: JSON.stringify(proofContext.steps),
    briefing: 'The pristine ledger shows its empty heading and add-expense guidance. Other filtering cases are unselected.', proofContext }
}
function harness(script: (call: StubCall) => ReturnType<typeof outcome> | Promise<ReturnType<typeof outcome>>) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-evidence-repair-')); repos.push(repoRoot)
  const { persistence } = memoryPersistence()
  const { driver, calls } = stubDriver(async call => {
    await call.emit({ type: 'assistant-turn', text: 'Reviewing selected case evidence.', usage: {
      inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0.001, costSource: 'unpriced',
    } })
    return script(call)
  })
  let dispatches = 0
  const ctx: ToolContext = { workItem: 'flow:empty:web', signal: new AbortController().signal,
    dispatchChild: (def, initialMessages) => runAgentLoop({ def, driver, persistence,
      sessionId: `review-${++dispatches}`, initialMessages, workItem: 'flow:empty:web' }).outcome }
  return { repoRoot, persistence, calls, ctx, tally: emptyFidelityTally() }
}

describe('fidelity child repairs proof metadata within its original budget', () => {
  it('repairs the stored [6,7,10,11] incident inside one child and caches only [6,7]', async () => {
    emptyLedgerEvidenceContext.steps.forEach(step => expect(GuardWebStepSchema.safeParse(step).success).toBe(true))
    const h = harness(call => {
      if (!call.input.resume) return outcome(faithful(invalidEmptyLedgerEvidence))
      expect(call.briefing).toContain('step 10')
      expect(call.briefing).toContain('step 11')
      expect(call.briefing).toContain('Eligible tagged assertion steps: [6, 7]')
      expect(call.briefing).toContain('not a semantic rejection')
      return outcome(faithful())
    })
    const review = await judgeWorkerFidelity({ ...h, universe, input: input() })
    expect(review).toEqual({ kind: 'faithful', evidence: correctedEmptyLedgerEvidence })
    expect(h.calls).toHaveLength(2)
    expect(h.tally).toMatchObject({ ran: 1, failed: 0, spent: { turns: 2, tokens: 30, costUsd: 0.002 } })
    expect(h.persistence.readEvents('review-1').filter(e => e.type === 'outcome')).toHaveLength(1)
    expect(h.persistence.readEvents('review-1').some(e => e.type === 'user-message' && e.content.includes('step 10'))).toBe(true)
    expect(await getCacheEntry(h.repoRoot, FIDELITY_SESSION_CACHE_NAME, fidelitySessionCacheKey(input()))).toEqual(faithful())
  })

  it.each([{ steps: [0, 1.5, 12] }, { steps: [] }])('repairs invalid numeric citation references $steps before completing', async ({ steps }) => {
    const h = harness(call => {
      if (!call.input.resume) return outcome(faithful([{ ...correctedEmptyLedgerEvidence[0], steps }]))
      expect(call.briefing).toContain('Eligible tagged assertion steps: [6, 7]')
      return outcome(faithful())
    })
    expect(await judgeWorkerFidelity({ ...h, universe, input: input() })).toMatchObject({ kind: 'faithful' })
    expect(h.calls).toHaveLength(2)
  })

  it('treats invalid cached evidence as a miss and revalidates against current typed context', async () => {
    const h = harness(() => outcome(faithful()))
    await setCacheEntry(h.repoRoot, FIDELITY_SESSION_CACHE_NAME, fidelitySessionCacheKey(input()), faithful(invalidEmptyLedgerEvidence))
    expect(await judgeWorkerFidelity({ ...h, universe, input: input() })).toMatchObject({ kind: 'faithful' })
    expect(h.calls).toHaveLength(1)
    expect(await judgeWorkerFidelity({ ...h, universe, input: input() })).toMatchObject({ kind: 'faithful' })
    expect(h.calls).toHaveLength(1)
    // The same cache identity cannot certify a context whose proof tags changed.
    const changed = structuredClone(emptyLedgerEvidenceContext)
    delete changed.steps[6].checks
    const changedInput = { ...input(), proofContext: changed }
    expect(await judgeWorkerFidelity({ ...h, universe, input: changedInput })).toMatchObject({ kind: 'unavailable' })
    expect(h.calls.length).toBeGreaterThan(1)
    expect(h.tally.failed).toBe(1)
  })

  it('exhausts repeated invalid citations without caching, reporting a semantic flag, or granting a new budget', async () => {
    const h = harness(() => outcome(faithful(invalidEmptyLedgerEvidence)))
    const review = await judgeWorkerFidelity({ ...h, universe, input: input() })
    expect(review).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('step 10') })
    expect(h.calls.length).toBeGreaterThan(1)
    expect(h.calls.length).toBeLessThanOrEqual(9)
    expect(h.calls.every(c => c.def.budget.turns === 5 && c.def.budget.maxResumes === 0)).toBe(true)
    expect(h.tally).toMatchObject({ ran: 1, failed: 1, allTransport: false })
    expect(h.persistence.readEvents('review-1').filter(e => e.type === 'outcome')).toHaveLength(0)
    expect(await getCacheEntry(h.repoRoot, FIDELITY_SESSION_CACHE_NAME, fidelitySessionCacheKey(input()))).toBeNull()
  })

  it('requires an author repair when an actual selected assertion is absent', async () => {
    const missing: GuardEvidenceProofContext = structuredClone(emptyLedgerEvidenceContext)
    delete missing.steps[5].expect
    delete missing.steps[6].expect
    const h = harness(call => {
      if (!call.input.resume) return outcome(faithful())
      expect(call.briefing).toContain('executable assertion')
      expect(call.briefing).toContain('do not invent proof')
      return outcome({ verdict: 'flagged', mismatch: 'Case 3/empty-ledger-state needs assertions for the pristine heading and guidance; steps 6 and 7 contain no executable expectations.', confidence: 'high' })
    })
    expect(await judgeWorkerFidelity({ ...h, universe, input: input(missing) })).toMatchObject({ kind: 'flagged', mismatch: expect.stringContaining('no executable expectations') })
    expect(h.calls).toHaveLength(2)
    expect(h.tally.failed).toBe(0)
  })

  it('snapshots proof context and defends cache writes from custom child dispatches', async () => {
    const context = structuredClone(emptyLedgerEvidenceContext)
    const def = fidelitySessionDef(universe, context)
    delete context.steps[5].checks
    expect(await def.validateOutcome!(faithful())).toBeUndefined()
    const h = harness(() => outcome(faithful()))
    const ctx = { ...h.ctx, dispatchChild: async () => ({ status: 'completed', output: faithful(invalidEmptyLedgerEvidence),
      pendingQuestions: [], spent: { turns: 1, tokens: 20, costUsd: 0.001 } }) } as ToolContext
    const review = await judgeWorkerFidelity({ ...h, ctx, universe, input: input() })
    expect(review).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('step 10') })
    expect(h.tally).toMatchObject({ failed: 1, allTransport: false, spent: { turns: 1, tokens: 20 } })
    expect(await getCacheEntry(h.repoRoot, FIDELITY_SESSION_CACHE_NAME, fidelitySessionCacheKey(input()))).toBeNull()
  })
})
