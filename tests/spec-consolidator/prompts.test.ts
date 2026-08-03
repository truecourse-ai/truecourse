import { describe, it, expect } from 'vitest'
import {
  RELEVANCE_SYSTEM_PROMPT,
  AREA_TAGGER_SYSTEM_PROMPT,
  VOCAB_NORMALIZER_SYSTEM_PROMPT,
  OVERLAP_DETECTOR_SYSTEM_PROMPT,
} from '../../packages/spec-consolidator/src/index.js'
import { OUTPUT_ONLY_GUARDRAIL } from '../../packages/shared/src/llm/transport.js'

/**
 * Every spec-scan LLM system prompt closes the action space with the ONE shared
 * output-only guardrail (relevance, area-tag, vocab, overlap).
 */
describe('spec-consolidator prompts carry the output-only guardrail', () => {
  const prompts: Array<[string, string]> = [
    ['RELEVANCE_SYSTEM_PROMPT', RELEVANCE_SYSTEM_PROMPT],
    ['AREA_TAGGER_SYSTEM_PROMPT', AREA_TAGGER_SYSTEM_PROMPT],
    ['VOCAB_NORMALIZER_SYSTEM_PROMPT', VOCAB_NORMALIZER_SYSTEM_PROMPT],
    ['OVERLAP_DETECTOR_SYSTEM_PROMPT', OVERLAP_DETECTOR_SYSTEM_PROMPT],
  ]

  it.each(prompts)('%s contains the guardrail', (_name, prompt) => {
    expect(prompt).toContain(OUTPUT_ONLY_GUARDRAIL)
  })
})

describe('OVERLAP_DETECTOR_SYSTEM_PROMPT preamble pointer', () => {
  it('instructs the model to use a null heading for a preamble conflict', () => {
    expect(OVERLAP_DETECTOR_SYSTEM_PROMPT).toContain('PREAMBLE')
    // The exact JSON shape must be spelled out for the small-tier model.
    expect(OVERLAP_DETECTOR_SYSTEM_PROMPT).toContain('"heading": null')
    expect(OVERLAP_DETECTOR_SYSTEM_PROMPT).toMatch(/before its first|above its first|ABOVE its first/i)
  })
})

describe('OVERLAP_DETECTOR_SYSTEM_PROMPT closed choice set + verbatim quote', () => {
  it('turns heading naming into SELECTION from a closed list (not free recall)', () => {
    expect(OVERLAP_DETECTOR_SYSTEM_PROMPT).toMatch(/CLOSED list/)
    expect(OVERLAP_DETECTOR_SYSTEM_PROMPT).toMatch(/SELECT from the list/i)
    // Explicitly forbids inventing a heading outside the list.
    expect(OVERLAP_DETECTOR_SYSTEM_PROMPT).toMatch(/never emit a heading that is not/i)
    expect(OVERLAP_DETECTOR_SYSTEM_PROMPT).toMatch(/one of that doc's listed section headings/)
  })

  it('offers the lead as an explicit option mapping to a null heading', () => {
    expect(OVERLAP_DETECTOR_SYSTEM_PROMPT).toMatch(/LEAD/)
    // The lead: pre-heading content, or the opening title block.
    expect(OVERLAP_DETECTOR_SYSTEM_PROMPT).toMatch(/opening title block/i)
    expect(OVERLAP_DETECTOR_SYSTEM_PROMPT).toContain('"heading": null')
  })

  it('requires a short verbatim quote of the disputed sentence per side', () => {
    expect(OVERLAP_DETECTOR_SYSTEM_PROMPT).toMatch(/quote/)
    expect(OVERLAP_DETECTOR_SYSTEM_PROMPT).toMatch(/verbatim/i)
    expect(OVERLAP_DETECTOR_SYSTEM_PROMPT).toMatch(/25 words/)
    expect(OVERLAP_DETECTOR_SYSTEM_PROMPT).toMatch(/do not paraphrase/i)
  })

  it('shows a worked example carrying both heading and quote (the exact JSON shape)', () => {
    expect(OVERLAP_DETECTOR_SYSTEM_PROMPT).toMatch(/"heading":\s*"User model",\s*"quote":/)
    // The preamble example is UPDATED to the null-heading + quote shape, not duplicated.
    expect(OVERLAP_DETECTOR_SYSTEM_PROMPT).toMatch(/"heading":\s*null,\s*"quote":/)
  })
})

describe('OVERLAP_DETECTOR_SYSTEM_PROMPT PARTS rule (windowed docs)', () => {
  it('names the part k/n label and forbids flagging a partial doc for omission', () => {
    expect(OVERLAP_DETECTOR_SYSTEM_PROMPT).toMatch(/PARTS/)
    expect(OVERLAP_DETECTOR_SYSTEM_PROMPT).toMatch(/part k\/n/)
    // A doc slice must never be flagged for what it omits/lacks/is missing.
    expect(OVERLAP_DETECTOR_SYSTEM_PROMPT).toMatch(/NEVER flag that it omits/i)
  })

  it('requires BOTH shown texts to explicitly state a difference before flagging', () => {
    expect(OVERLAP_DETECTOR_SYSTEM_PROMPT).toMatch(/both shown texts explicitly state/i)
    expect(OVERLAP_DETECTOR_SYSTEM_PROMPT).toMatch(/silence in one part is never a disagreement/i)
  })
})
