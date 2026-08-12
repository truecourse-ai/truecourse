/**
 * The visual judge's SCHEMA half: the verdict shape a vision model must return,
 * the compact annotation a run result stores inline, and the transcript lines a
 * human reads. The load-bearing property is BACKWARD COMPATIBILITY — the field is
 * additive and optional, so every `LATEST.json` written before the judge existed
 * still parses (that is why there is no format-version bump).
 */

import { describe, it, expect } from 'vitest'
import {
  GuardFailureDetailSchema,
  GuardVisualAnnotationSchema,
  GuardVisualJudgmentSchema,
  VISUAL_SUMMARY_LIMIT,
  visualAnnotation,
  visualJudgeLines,
  type GuardVisualJudgment,
} from '../../packages/shared/src/guard/index.js'

const judgment: GuardVisualJudgment = {
  expectedVisible: 'no',
  screenSummary: 'The notes list is empty and a red "Failed to load" banner covers the header.',
  rationale: 'No row with the text "Buy milk" appears anywhere; the list region renders an error state.',
}

describe('GuardVisualJudgmentSchema', () => {
  it('accepts the three answers and rejects anything else', () => {
    for (const expectedVisible of ['yes', 'no', 'unclear'] as const) {
      expect(GuardVisualJudgmentSchema.safeParse({ ...judgment, expectedVisible }).success).toBe(true)
    }
    expect(GuardVisualJudgmentSchema.safeParse({ ...judgment, expectedVisible: 'maybe' }).success).toBe(false)
  })

  it('requires a summary and a rationale, and refuses unknown keys', () => {
    expect(GuardVisualJudgmentSchema.safeParse({ ...judgment, screenSummary: '' }).success).toBe(false)
    expect(GuardVisualJudgmentSchema.safeParse({ expectedVisible: 'no' }).success).toBe(false)
    expect(GuardVisualJudgmentSchema.safeParse({ ...judgment, verdict: 'no' }).success).toBe(false)
  })
})

describe('visualAnnotation', () => {
  it('carries the verdict and a whitespace-collapsed summary', () => {
    const annotated = visualAnnotation({ ...judgment, screenSummary: 'a\n  b   c' })
    expect(annotated).toEqual({ verdict: 'no', summary: 'a b c' })
    expect(GuardVisualAnnotationSchema.safeParse(annotated).success).toBe(true)
  })

  it('caps the inline summary — LATEST.json is compact, the transcript is not', () => {
    const annotated = visualAnnotation({ ...judgment, screenSummary: 'x'.repeat(1_000) })
    expect(annotated.summary.length).toBe(VISUAL_SUMMARY_LIMIT)
    expect(annotated.summary.endsWith('…')).toBe(true)
  })
})

describe('visualJudgeLines', () => {
  it('a `no` verdict says the expected result is not visible', () => {
    const lines = visualJudgeLines(judgment).join('\n')
    expect(lines).toContain('visual-judge:')
    expect(lines).toContain('NOT visible')
    expect(lines).toContain(judgment.rationale)
    // Never claim to have decided anything.
    expect(lines).toContain('ANNOTATION')
  })

  it('a `yes` verdict names the assertion itself as the suspect', () => {
    const lines = visualJudgeLines({ ...judgment, expectedVisible: 'yes' }).join('\n')
    expect(lines).toContain('APPEARS VISIBLE')
    expect(lines).toContain('the assertion itself may be wrong')
  })

  it('an `unclear` verdict claims nothing either way', () => {
    const lines = visualJudgeLines({ ...judgment, expectedVisible: 'unclear' }).join('\n')
    expect(lines).toContain('does not settle')
  })
})

describe('GuardFailureDetail — the visual annotation is additive', () => {
  it('round-trips a failure carrying a verdict', () => {
    const detail = {
      step: 3,
      expected: 'the page text contains "Buy milk"',
      actual: 'the page text was ""',
      visual: { verdict: 'no' as const, summary: 'An empty list under an error banner.' },
    }
    const parsed = GuardFailureDetailSchema.safeParse(detail)
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.visual?.verdict).toBe('no')
  })

  it('a pre-judge failure (no `visual` key) still parses — no format-version bump', () => {
    const parsed = GuardFailureDetailSchema.safeParse({
      step: 1,
      expected: 'exit 0',
      actual: 'exit 1',
      stdout: 'boom',
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.visual).toBeUndefined()
  })

  it('rejects a malformed verdict rather than storing nonsense', () => {
    expect(
      GuardFailureDetailSchema.safeParse({
        step: 1,
        expected: 'e',
        actual: 'a',
        visual: { verdict: 'probably', summary: 's' },
      }).success,
    ).toBe(false)
  })
})
