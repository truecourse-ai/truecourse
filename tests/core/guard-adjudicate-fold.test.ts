/**
 * THE FOLD'S REFUSAL INVARIANTS (plan 05 step 22, item 1) — the structural
 * rules `adjudicationRefusalReason` states that the outcome schema cannot.
 *
 * The schema can say "a control has a conclusion"; it cannot say "a `bug`
 * verdict must name a file:line", "a `bug` at medium-or-better confidence must
 * stand on a control the ENGINE ran", or "a refuted control forbids the class".
 * Those are the difference between a verdict and a guess wearing a verdict's
 * shape, so they are pinned here, one case per rule.
 *
 * `state` is the session's engine-side control stash — present for a FRESH
 * outcome, absent for a cached/deterministic one. The stash check is the half
 * that cannot be re-proved later (the session that ran the control is gone), so
 * a state-less verdict is checked STRUCTURALLY only; the last case pins exactly
 * that, because silently tightening it would make every cache read a refusal.
 */

import { describe, it, expect } from 'vitest'
import type { GuardAdjudication } from '@truecourse/shared'
import { adjudicationRefusalReason } from '../../packages/core/src/services/guard-adjudicate/fold'
import { newSessionState } from '../../packages/core/src/services/guard-adjudicate/tools'

/** A structurally minimal verdict of `class`, with the pieces each case adds. */
function verdict(over: Partial<GuardAdjudication> & Pick<GuardAdjudication, 'class'>): GuardAdjudication {
  return {
    mechanism: 'the mechanism, in plain words',
    evidence: ['a verbatim line from the evidence'],
    confidence: 'high',
    findings: [],
    ...over,
  }
}

const CODE = { file: 'src/api/todos.ts', line: 42 }

/** A stash holding one control the engine really ran. */
function stashed(ref: string, conclusion: 'confirms' | 'refutes' | 'inconclusive') {
  const state = newSessionState()
  state.controls.set(ref, { conclusion, reasoning: 'the experiment and what it showed' })
  return state
}

describe('adjudicationRefusalReason — a `bug` must be located and controlled', () => {
  it('refuses a `bug` with no `code`, naming the field', () => {
    const reason = adjudicationRefusalReason(verdict({ class: 'bug', confidence: 'high' }))
    expect(reason).not.toBeNull()
    expect(reason).toContain('code')
  })

  it('refuses a located `bug` with no control at medium AND at high confidence', () => {
    for (const confidence of ['medium', 'high'] as const) {
      const reason = adjudicationRefusalReason(verdict({ class: 'bug', confidence, code: CODE }))
      expect(reason, confidence).not.toBeNull()
      expect(reason, confidence).toContain('control')
    }
  })

  it('lets a LOW-confidence located `bug` stand without a control', () => {
    expect(
      adjudicationRefusalReason(verdict({ class: 'bug', confidence: 'low', code: CODE })),
    ).toBeNull()
  })
})

describe('adjudicationRefusalReason — a defect verdict must name its fix', () => {
  it('refuses `authoring-defect` and `seed-defect` without `fix`', () => {
    for (const cls of ['authoring-defect', 'seed-defect'] as const) {
      const reason = adjudicationRefusalReason(verdict({ class: cls }))
      expect(reason, cls).not.toBeNull()
      expect(reason, cls).toContain('fix')
    }
  })

  it('accepts one that carries the fix', () => {
    expect(
      adjudicationRefusalReason(
        verdict({
          class: 'authoring-defect',
          fix: { layer: 'scenario', description: 'assert the exit code, not the banner' },
        }),
      ),
    ).toBeNull()
  })
})

describe('adjudicationRefusalReason — the control stash is the engine’s, not the model’s', () => {
  const control = (conclusion: 'confirms' | 'refutes' | 'inconclusive', transcriptRef: string) => ({
    conclusion,
    reasoning: 'what the control ran and what it showed',
    transcriptRef,
  })

  it('refuses a reference no control the engine ran ever minted', () => {
    const reason = adjudicationRefusalReason(
      verdict({ class: 'bug', code: CODE, control: control('confirms', 'ref-invented') }),
      stashed('ref1', 'confirms'),
    )
    expect(reason).toContain('names no control the engine ran')
  })

  it('refuses a verdict that RESTATES its control’s conclusion', () => {
    const reason = adjudicationRefusalReason(
      verdict({ class: 'drift', control: control('refutes', 'ref1') }),
      stashed('ref1', 'confirms'),
    )
    expect(reason).toContain('may not restate its control')
  })

  it('accepts the reference the engine minted, quoted verbatim', () => {
    expect(
      adjudicationRefusalReason(
        verdict({ class: 'bug', code: CODE, control: control('confirms', 'ref1') }),
        stashed('ref1', 'confirms'),
      ),
    ).toBeNull()
  })

  it('refuses `bug` on a control that REFUTED it, and says to downgrade', () => {
    const reason = adjudicationRefusalReason(
      verdict({ class: 'bug', code: CODE, control: control('refutes', 'ref1') }),
      stashed('ref1', 'refutes'),
    )
    expect(reason).toContain('downgrade the class')
  })

  it('refuses a refuting control on the CACHE path too (no stash to check)', () => {
    const reason = adjudicationRefusalReason(
      verdict({ class: 'bug', code: CODE, control: control('refutes', 'control-deadbeef') }),
    )
    expect(reason).toContain('downgrade the class')
  })

  /**
   * The cache path CANNOT re-prove the stash: the session that ran the control
   * belongs to the run that produced the cached verdict, and demanding a live
   * stash here would turn every cache hit into a refusal. So the state-less
   * check is structural only — and a structurally complete verdict stands.
   */
  it('accepts a structurally complete cached `bug` whose control is unverifiable', () => {
    expect(
      adjudicationRefusalReason(
        verdict({ class: 'bug', code: CODE, control: control('confirms', 'control-deadbeef') }),
      ),
    ).toBeNull()
  })
})
