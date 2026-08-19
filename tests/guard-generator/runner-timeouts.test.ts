/**
 * The per-stage wall-clock ceilings each surviving spawn* runner hands the
 * transport.
 *
 * These are load-bearing numbers, not defaults nobody reads: the ceiling is the
 * ONLY guard covering pre-first-token silence (the stall timer arms on the first
 * stream event), so it decides whether a long-reasoning call is allowed to
 * finish or is SIGKILLed mid-flight.
 *
 * Only TWO one-shot stages are left (plan 04 step 20): recipe discovery and
 * realization matching. Extraction, flow synthesis, authoring, fidelity and
 * triage run as agent sessions now, and a session's ceiling is its BUDGET
 * (turns / resumes / token ceiling), pinned beside each session def — there is
 * no per-stage `timeoutMs` for them to carry.
 */
import { describe, it, expect } from 'vitest'
import { spawnMatchRunner, spawnRecipeRunner, type MatchUserContext } from '@truecourse/guard-generator'
// Not re-exported by the package barrel — read from source.
import type { RecipeDiscoveryInput } from '../../packages/guard-generator/src/prompts.js'
import type { LlmTransport } from '@truecourse/shared/llm'

/** A transport that records the request and answers with empty JSON. */
function recorder(): { seen: { stage?: string; timeoutMs?: number }[]; transport: LlmTransport } {
  const seen: { stage?: string; timeoutMs?: number }[] = []
  const transport: LlmTransport = async (req) => {
    seen.push({ stage: req.stage, timeoutMs: req.timeoutMs })
    return '{}'
  }
  return { seen, transport }
}

const matchCtx: MatchUserContext = {
  flow: { id: 'version', title: 'version', goal: 'the version prints' },
  milestones: [{ order: 1, claim: 'v' }],
  surface: 'cli',
  interfaces: [],
}
const recipeInput: RecipeDiscoveryInput = {
  packageJson: '{"name":"relkit"}',
  presentInputs: ['package.json'],
}

describe('guard runner wall-clock ceilings', () => {
  it('the two surviving one-shot stages keep their own ceilings', async () => {
    const { seen, transport } = recorder()
    await spawnMatchRunner({ transport })(matchCtx)
    await spawnRecipeRunner({ transport })(recipeInput)
    expect(seen).toEqual([
      { stage: 'guard.match', timeoutMs: 300_000 },
      { stage: 'guard.recipe', timeoutMs: 120_000 },
    ])
  })

  it('an explicit timeoutMs still overrides a stage default', async () => {
    const { seen, transport } = recorder()
    await spawnMatchRunner({ transport, timeoutMs: 42_000 })(matchCtx)
    expect(seen[0].timeoutMs).toBe(42_000)
  })
})
