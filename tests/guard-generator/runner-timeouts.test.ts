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
  spawnGenerateRunner,
  spawnFidelityRunner,
  spawnFlowsRunner,
  spawnFlowsEpicRunner,
  spawnMatchRunner,
  spawnRecipeRunner,
  type AuthorUserContext,
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
const authorCtx: AuthorUserContext = {
  flow: { id: 'version', title: 'version', goal: 'the version prints' },
  milestones: [
    {
      order: 1,
      claim: 'v',
      doc: 'docs/cli.md',
      sectionHeading: 'version',
      sectionText: '`relkit --version` prints the version.',
      realization: ['run: ["--version"]'],
    },
  ],
  interfacePath: ['cli/relkit'],
  areaTags: [],
  driver: 'cli',
  recipeEntry: ['node', 'bin.mjs'],
  recipeBuild: 'true',
}
const fidelityCtx: FidelityUserContext = {
  flow: { id: 'version', title: 'version', goal: 'the version prints' },
  milestones: [
    { order: 1, claim: 'v', doc: 'docs/cli.md', sectionHeading: 'version', sectionText: 'text' },
  ],
  scenarioYaml: 'title: t\n',
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
  interfaces: [],
}
const recipeInput: RecipeDiscoveryInput = {
  packageJson: '{"name":"relkit"}',
  presentInputs: ['package.json'],
}

describe('guard runner wall-clock ceilings', () => {
  it('authoring (and its retry, same runner) gets the 15-minute ceiling', async () => {
    const { seen, transport } = recorder()
    const runner = spawnGenerateRunner({ transport })
    await runner(authorCtx)
    await runner({ ...authorCtx, retry: { scenarioTitle: 't', step: 1, expected: 'e', actual: 'a' } })
    expect(seen.map((s) => s.stage)).toEqual(['guard.generate', 'guard.retry'])
    expect(seen.map((s) => s.timeoutMs)).toEqual([900_000, 900_000])
  })

  it('an explicit timeoutMs still overrides the authoring default', async () => {
    const { seen, transport } = recorder()
    await spawnGenerateRunner({ transport, timeoutMs: 42_000 })(authorCtx)
    expect(seen[0].timeoutMs).toBe(42_000)
  })

  it('every other stage keeps its own ceiling — the widening is authoring-only', async () => {
    const { seen, transport } = recorder()
    await spawnExtractRunner({ transport })(extractCtx)
    await spawnFlowsRunner({ transport })(flowsCtx)
    await spawnFlowsEpicRunner({ transport })(epicCtx)
    await spawnMatchRunner({ transport })(matchCtx)
    await spawnFidelityRunner({ transport })(fidelityCtx)
    await spawnRecipeRunner({ transport })(recipeInput)
    expect(seen).toEqual([
      { stage: 'guard.extract', timeoutMs: 600_000 },
      { stage: 'guard.flows', timeoutMs: 600_000 },
      { stage: 'guard.flows', timeoutMs: 600_000 },
      { stage: 'guard.match', timeoutMs: 300_000 },
      { stage: 'guard.fidelity', timeoutMs: 120_000 },
      { stage: 'guard.recipe', timeoutMs: 120_000 },
    ])
  })
})
