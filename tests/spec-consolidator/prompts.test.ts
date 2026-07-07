import { describe, it, expect } from 'vitest'
import {
  RELEVANCE_SYSTEM_PROMPT,
  AREA_TAGGER_SYSTEM_PROMPT,
  VOCAB_NORMALIZER_SYSTEM_PROMPT,
  OVERLAP_DETECTOR_SYSTEM_PROMPT,
  CHAIN_DETECTION_SYSTEM_PROMPT,
} from '../../packages/spec-consolidator/src/index.js'
import { OUTPUT_ONLY_GUARDRAIL } from '../../packages/shared/src/llm/transport.js'

/**
 * Every spec-scan LLM system prompt closes the action space with the ONE shared
 * output-only guardrail (relevance, area-tag, vocab, overlap, and chain/relation
 * detection — chain detection is the single prompt relation.ts reuses).
 */
describe('spec-consolidator prompts carry the output-only guardrail', () => {
  const prompts: Array<[string, string]> = [
    ['RELEVANCE_SYSTEM_PROMPT', RELEVANCE_SYSTEM_PROMPT],
    ['AREA_TAGGER_SYSTEM_PROMPT', AREA_TAGGER_SYSTEM_PROMPT],
    ['VOCAB_NORMALIZER_SYSTEM_PROMPT', VOCAB_NORMALIZER_SYSTEM_PROMPT],
    ['OVERLAP_DETECTOR_SYSTEM_PROMPT', OVERLAP_DETECTOR_SYSTEM_PROMPT],
    ['CHAIN_DETECTION_SYSTEM_PROMPT', CHAIN_DETECTION_SYSTEM_PROMPT],
  ]

  it.each(prompts)('%s contains the guardrail', (_name, prompt) => {
    expect(prompt).toContain(OUTPUT_ONLY_GUARDRAIL)
  })
})
