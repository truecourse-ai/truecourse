/**
 * The per-stage wall-clock ceilings each spawn* runner hands the transport.
 *
 * These are load-bearing numbers, not defaults nobody reads: the ceiling is the
 * ONLY guard covering pre-first-token silence (the stall timer arms on the first
 * stream event), so it decides whether a long-reasoning call is allowed to
 * finish or is SIGKILLed mid-flight. Authoring is deliberately the widest.
 */
import { describe, it, expect } from 'vitest'
import {
  spawnExtractRunner,
  spawnFidelityRunner,
  spawnFlowsRunner,
  spawnFlowsEpicRunner,
  spawnMatchRunner,
  spawnRecipeRunner,
  ADJUDICATION_TIMEOUT_MS,
  type FidelityUserContext,
  type FlowsUserContext,
  type FlowsEpicUserContext,
  type MatchUserContext,
} from '@truecourse/guard-generator'
// Not re-exported by the package barrel — read from source.
import type {
  ExtractUserContext,
  RecipeDiscoveryInput,
} from '../../packages/guard-generator/src/prompts.js'
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

const extractCtx: ExtractUserContext = {
  doc: 'docs/cli.md',
  outline: [{ anchor: 'version', headingText: 'version', level: 2 }],
  viewText: '`relkit --version` prints the version.',
}
const fidelityCtx: FidelityUserContext = {
  flow: { id: 'version', title: 'version', goal: 'the version prints' },
  milestones: [
    { order: 1, claim: 'v', doc: 'docs/cli.md', sectionHeading: 'version', sectionText: 'text' },
  ],
  scenarioYaml: 'title: t\n',
  scenarioId: 'version.cli.1',
  surface: 'cli',
}
const flowsCtx: FlowsUserContext = {
  areaId: 'cli',
  claims: [
    { doc: 'docs/cli.md', anchor: 'version', claim: 'prints the version', driver: 'cli', required: true },
  ],
  docs: [],
}
const epicCtx: FlowsEpicUserContext = {
  digests: [
    {
      ref: 'cli/version',
      areaId: 'cli',
      title: 'version',
      goal: 'the version prints',
      milestones: [{ doc: 'docs/cli.md', anchor: 'version', claimTitle: 'v' }],
    },
  ],
}
const matchCtx: MatchUserContext = {
  flow: { id: 'version', title: 'version', goal: 'the version prints' },
  milestones: [{ order: 1, claim: 'v' }],
  surface: 'cli',
  journeys: [],
}
const recipeInput: RecipeDiscoveryInput = {
  packageJson: '{"name":"relkit"}',
  presentInputs: ['package.json'],
}

describe('guard runner wall-clock ceilings', () => {
  // Scenario authoring has no one-shot runner: both surfaces author through the
  // flow worker's turn seam, whose per-turn ceiling lives in generate.ts.
  it('every stage keeps its own ceiling', async () => {
    const { seen, transport } = recorder()
    await spawnExtractRunner({ transport })(extractCtx)
    await spawnFlowsRunner({ transport })(flowsCtx)
    await spawnFlowsEpicRunner({ transport })(epicCtx)
    await spawnMatchRunner({ transport })(matchCtx)
    await spawnRecipeRunner({ transport })(recipeInput)
    expect(seen).toEqual([
      { stage: 'guard.extract', timeoutMs: 600_000 },
      { stage: 'guard.flows', timeoutMs: 600_000 },
      { stage: 'guard.flows', timeoutMs: 600_000 },
      { stage: 'guard.match', timeoutMs: 300_000 },
      { stage: 'guard.recipe', timeoutMs: 120_000 },
    ])
  })

  // Adjudication carries the heaviest per-call payload after authoring: a scenario
  // plus its flow's sections, verbatim. At two minutes the ceiling was killing live
  // reviews and leaving their greens unjudged, so it sits in the heavy-stage tier.
  it('adjudication gets the heavy-stage ceiling, not two minutes', async () => {
    const { seen, transport } = recorder()
    await spawnFidelityRunner({ transport })(fidelityCtx)
    expect(seen).toEqual([{ stage: 'guard.fidelity', timeoutMs: ADJUDICATION_TIMEOUT_MS }])
    expect(ADJUDICATION_TIMEOUT_MS).toBe(600_000)
  })

  it('an explicit timeoutMs still overrides the adjudication default', async () => {
    const { seen, transport } = recorder()
    await spawnFidelityRunner({ transport, timeoutMs: 42_000 })(fidelityCtx)
    expect(seen[0].timeoutMs).toBe(42_000)
  })

  // The tally can only name the tests a stage lost calls for if the calls carry
  // their subject — a stage id alone sends the reader back to the logs.
  it('an adjudication request names the scenario it is judging', async () => {
    const seen: { subject?: string; id?: string }[] = []
    const transport: LlmTransport = async (req) => {
      seen.push({ subject: req.subject, id: req.id })
      return '{}'
    }
    await spawnFidelityRunner({ transport })(fidelityCtx)
    expect(seen.map((s) => s.subject)).toEqual(['version.cli.1'])
    // A flow's two reviews are two calls: the id separates them by surface.
    expect(seen[0].id).toBe('guard.fidelity:version:cli')
  })
})
