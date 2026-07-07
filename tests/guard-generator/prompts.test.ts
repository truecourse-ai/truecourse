import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  EXTRACT_SYSTEM_PROMPT,
  GENERATE_SYSTEM_PROMPT,
  RECIPE_SYSTEM_PROMPT,
} from '@truecourse/guard-generator'
import { OUTPUT_ONLY_GUARDRAIL } from '@truecourse/shared/llm'

/** The same content fingerprint the engine folds into the cache keys. */
const fingerprint = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 16)

describe('guard-generator prompts', () => {
  it('GENERATE_SYSTEM_PROMPT carries the world-state capabilities block', () => {
    expect(GENERATE_SYSTEM_PROMPT).toContain('# World-state capabilities')
    expect(GENERATE_SYSTEM_PROMPT).toContain('setup.git')
    // The sandbox realities, one line each.
    expect(GENERATE_SYSTEM_PROMPT).toContain('no network')
    expect(GENERATE_SYSTEM_PROMPT).toContain('allowlisted')
    expect(GENERATE_SYSTEM_PROMPT).toContain('no shell')
  })

  it('GENERATE_SYSTEM_PROMPT documents the blockedOn output shape', () => {
    expect(GENERATE_SYSTEM_PROMPT).toContain('blockedOn')
    expect(GENERATE_SYSTEM_PROMPT).toContain('service|db|network|credentials')
  })

  it('GENERATE_SYSTEM_PROMPT closes the action space (no tools / no repo access)', () => {
    expect(GENERATE_SYSTEM_PROMPT).toContain('# No tools, no repository access')
    expect(GENERATE_SYSTEM_PROMPT).toContain('You have NO tools and NO repository access')
    expect(GENERATE_SYSTEM_PROMPT).toContain('<tool_use>')
    // Points the model at the injected transcripts instead of inspecting code.
    expect(GENERATE_SYSTEM_PROMPT).toContain('REAL BEHAVIOR')
  })

  it('EXTRACT and RECIPE carry the shared output-only guardrail', () => {
    expect(EXTRACT_SYSTEM_PROMPT).toContain(OUTPUT_ONLY_GUARDRAIL)
    expect(RECIPE_SYSTEM_PROMPT).toContain(OUTPUT_ONLY_GUARDRAIL)
  })

  it('GENERATE keeps its own richer no-tools block, not the shared constant', () => {
    // GENERATE was hardened by an earlier pass with a fuller block; leave it as is.
    expect(GENERATE_SYSTEM_PROMPT).not.toContain(OUTPUT_ONLY_GUARDRAIL)
    expect(GENERATE_SYSTEM_PROMPT).toContain('# No tools, no repository access')
  })

  it('EXTRACT_PROMPT_FINGERPRINT moved once for the guardrail — now pinned again', () => {
    // Pinned literal: adding OUTPUT_ONLY_GUARDRAIL moved this from 811fa5b607321c96
    // (the one-time budgeted guard re-extract). It must not move again silently.
    expect(fingerprint(EXTRACT_SYSTEM_PROMPT)).toBe('d2fdc2266c5a8408')
  })
})
