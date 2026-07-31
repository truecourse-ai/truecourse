/**
 * Every guard-generator stage sends its response schema on the request, rendered
 * from the SAME Zod definition the engine validates the reply with, so the API
 * transport can enforce the shape via structured output (the cli transport
 * ignores it). Each case also pins the request's prompts to the exported system
 * constant + user builder — the strings the stage fingerprints hash — so a schema
 * addition can never move a cache key.
 */
import { describe, it, expect } from 'vitest'
import { GuardTriageSchema } from '@truecourse/shared'
import { jsonSchemaHint, type LlmRequest, type LlmTransport } from '@truecourse/shared/llm'
import {
  spawnExtractRunner,
  spawnGenerateRunner,
  spawnFidelityRunner,
  spawnTriageRunner,
  spawnExemplarRunner,
  spawnClusterRunner,
  spawnRecipeRunner,
} from '../../packages/guard-generator/src/runners.js'
import {
  EXTRACT_SYSTEM_PROMPT,
  buildExtractUserPrompt,
  GENERATE_SYSTEM_PROMPT,
  buildAuthorUserPrompt,
  FIDELITY_SYSTEM_PROMPT,
  buildFidelityUserPrompt,
  RECIPE_SYSTEM_PROMPT,
  buildRecipeUserPrompt,
  type AuthorUserContext,
  type ExtractUserContext,
  type FidelityUserContext,
  type RecipeDiscoveryInput,
} from '../../packages/guard-generator/src/prompts.js'
import {
  TRIAGE_SYSTEM_PROMPT,
  buildTriageUserPrompt,
  type TriageUserContext,
} from '../../packages/guard-generator/src/triage.js'
import {
  EXEMPLAR_SYSTEM_PROMPT,
  buildExemplarUserPrompt,
  ExemplarPackSchema,
  type ExemplarUserContext,
} from '../../packages/guard-generator/src/exemplars.js'
import {
  CLUSTER_SYSTEM_PROMPT,
  buildClusterUserPrompt,
  ClusterResponseSchema,
  type ClusterUserContext,
} from '../../packages/guard-generator/src/cluster.js'
import {
  DocExtractionSchema,
  AuthoredBatchSchema,
  FidelityReviewSchema,
  RecipeProposalSchema,
} from '../../packages/guard-generator/src/schemas.js'
import type { SectionInput } from '../../packages/guard-generator/src/section-plan.js'

/** A transport that answers every call with `response` and records the requests. */
function capture(response: string): { transport: LlmTransport; reqs: LlmRequest[] } {
  const reqs: LlmRequest[] = []
  return {
    reqs,
    transport: async (req) => {
      reqs.push(req)
      return response
    },
  }
}

const DOC = 'docs/cli.md'

const SECTION: SectionInput = {
  doc: DOC,
  anchor: 'version',
  fingerprint: 'sha256:x',
  headingText: 'version',
  level: 2,
  ownText: 'The CLI prints its version.',
  fullText: 'The CLI prints its version.',
  areaTags: [],
}

const extractCtx: ExtractUserContext = {
  doc: DOC,
  outline: [{ anchor: 'version', headingText: 'version', level: 2 }],
  viewText: '## version\nThe CLI prints its version.',
}

const authorCtx: AuthorUserContext = {
  doc: DOC,
  docContext: 'doc context',
  areaTags: [],
  recipeEntry: ['node', 'bin.mjs'],
  recipeBuild: 'true',
  claims: [{ ref: 'c0', claim: 'prints its version', section: SECTION }],
}

const fidelityCtx: FidelityUserContext = {
  doc: DOC,
  sectionHeading: 'version',
  sectionText: 'The CLI prints its version.',
  claim: 'prints its version',
  scenarioYaml: 'title: prints its version\n',
}

const triageCtx: TriageUserContext = {
  doc: DOC,
  sectionHeading: 'version',
  sectionText: 'The CLI prints its version.',
  claim: 'prints its version',
  kind: 'birth',
  scenarioYaml: 'title: prints its version\n',
  step: 1,
  expected: '0.1.0',
  actual: 'command not found',
}

const exemplarCtx: ExemplarUserContext = {
  kind: 'dialect',
  subject: 'the Postgres SQL dialect',
  claim: 'supports the Postgres dialect',
  count: 3,
}

const clusterCtx: ClusterUserContext = { briefs: ['a', 'b', 'c'] }

const recipeInput: RecipeDiscoveryInput = {
  manifests: [{ path: 'package.json', ecosystem: 'node', content: '{"bin":{"tc":"bin.mjs"}}' }],
  presentInputs: ['pnpm-lock.yaml'],
}

describe('guard-generator runners send their stage schema with unchanged prompts', () => {
  it('guard.extract — the doc-extraction schema', async () => {
    const { transport, reqs } = capture(JSON.stringify({ claims: [], untestable: [] }))
    await spawnExtractRunner({ transport })(extractCtx)
    expect(reqs).toHaveLength(1)
    expect(reqs[0].system).toBe(EXTRACT_SYSTEM_PROMPT)
    expect(reqs[0].user).toBe(buildExtractUserPrompt(extractCtx))
    expect(reqs[0].schema).toBe(jsonSchemaHint(DocExtractionSchema))
  })

  it('guard.generate — the authored-batch schema', async () => {
    const { transport, reqs } = capture(JSON.stringify({ claims: [] }))
    await spawnGenerateRunner({ transport })(authorCtx)
    expect(reqs).toHaveLength(1)
    expect(reqs[0].system).toBe(GENERATE_SYSTEM_PROMPT)
    expect(reqs[0].user).toBe(buildAuthorUserPrompt(authorCtx))
    expect(reqs[0].schema).toBe(jsonSchemaHint(AuthoredBatchSchema))
  })

  it('guard.fidelity — the review schema', async () => {
    const { transport, reqs } = capture(JSON.stringify({ verdict: 'faithful' }))
    await spawnFidelityRunner({ transport })(fidelityCtx)
    expect(reqs).toHaveLength(1)
    expect(reqs[0].system).toBe(FIDELITY_SYSTEM_PROMPT)
    expect(reqs[0].user).toBe(buildFidelityUserPrompt(fidelityCtx))
    expect(reqs[0].schema).toBe(jsonSchemaHint(FidelityReviewSchema))
  })

  it('guard.triage — the triage verdict schema', async () => {
    const { transport, reqs } = capture(
      JSON.stringify({ verdict: 'doc-drift', confidence: 'high', brief: 'b', recommendation: 'r' }),
    )
    await spawnTriageRunner({ transport })(triageCtx)
    expect(reqs).toHaveLength(1)
    expect(reqs[0].system).toBe(TRIAGE_SYSTEM_PROMPT)
    expect(reqs[0].user).toBe(buildTriageUserPrompt(triageCtx))
    expect(reqs[0].schema).toBe(jsonSchemaHint(GuardTriageSchema))
  })

  it('guard.exemplars — the exemplar-pack schema', async () => {
    const { transport, reqs } = capture(JSON.stringify({ exemplars: [{ content: 'select 1' }] }))
    await spawnExemplarRunner({ transport })(exemplarCtx)
    expect(reqs).toHaveLength(1)
    expect(reqs[0].system).toBe(EXEMPLAR_SYSTEM_PROMPT)
    expect(reqs[0].user).toBe(buildExemplarUserPrompt(exemplarCtx))
    expect(reqs[0].schema).toBe(jsonSchemaHint(ExemplarPackSchema))
  })

  it('guard.cluster — the families schema', async () => {
    const { transport, reqs } = capture(JSON.stringify({ families: [] }))
    await spawnClusterRunner({ transport })(clusterCtx)
    expect(reqs).toHaveLength(1)
    expect(reqs[0].system).toBe(CLUSTER_SYSTEM_PROMPT)
    expect(reqs[0].user).toBe(buildClusterUserPrompt(clusterCtx))
    expect(reqs[0].schema).toBe(jsonSchemaHint(ClusterResponseSchema))
  })

  it('guard.recipe — the recipe-proposal schema', async () => {
    const { transport, reqs } = capture(JSON.stringify({ build: 'true', entry: ['node', 'bin.mjs'] }))
    await spawnRecipeRunner({ transport })(recipeInput)
    expect(reqs).toHaveLength(1)
    expect(reqs[0].system).toBe(RECIPE_SYSTEM_PROMPT)
    expect(reqs[0].user).toBe(buildRecipeUserPrompt(recipeInput))
    expect(reqs[0].schema).toBe(jsonSchemaHint(RecipeProposalSchema))
  })

  it('every stage schema is a parseable, object-rooted JSON schema', async () => {
    const { transport, reqs } = capture('{}')
    const runs: Array<() => Promise<unknown>> = [
      () => spawnExtractRunner({ transport })(extractCtx),
      () => spawnGenerateRunner({ transport })(authorCtx),
      () => spawnFidelityRunner({ transport })(fidelityCtx),
      () => spawnTriageRunner({ transport })(triageCtx),
      () => spawnExemplarRunner({ transport })(exemplarCtx),
      () => spawnClusterRunner({ transport })(clusterCtx),
      () => spawnRecipeRunner({ transport })(recipeInput),
    ]
    for (const run of runs) await run()
    expect(reqs).toHaveLength(runs.length)
    for (const req of reqs) {
      expect(typeof req.schema).toBe('string')
      const parsed = JSON.parse(req.schema as string) as Record<string, unknown>
      // Object-rooted without exception: JSON mode can return nothing else.
      expect(parsed.type).toBe('object')
    }
  })
})
