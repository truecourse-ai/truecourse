import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  suggestAdrsInProcess,
  type AdrSuggestEvent,
} from '../../apps/server/src/services/llm/adr-suggester'
import {
  listAdrDrafts,
} from '../../apps/server/src/lib/adr-store'
import type {
  LLMProvider,
  AdrSurveyContext,
  AdrSurveyResult,
  AdrDraftContext,
  AdrDraftResult,
} from '../../apps/server/src/services/llm/provider'
import type { Graph } from '../../apps/server/src/types/snapshot'
import type { TopicSignature } from '../../packages/shared/src/types/adr'

// ---------------------------------------------------------------------------
// Mock LLM provider
// ---------------------------------------------------------------------------
//
// Records every call; returns canned data. Only the two ADR methods need
// real behavior; the rest throw so any test-under-test that accidentally
// calls them fails loud.

interface MockResponses {
  survey?: AdrSurveyResult
  drafts?: Map<string, AdrDraftResult | Error>  // keyed by topic
}

function makeMockProvider(responses: MockResponses): LLMProvider & {
  calls: { survey: AdrSurveyContext[]; draft: AdrDraftContext[] }
} {
  const calls = { survey: [] as AdrSurveyContext[], draft: [] as AdrDraftContext[] }
  const notImpl = (m: string) => () => { throw new Error(`mock provider: ${m} not stubbed`) }

  return {
    calls,
    generateAdrSurvey: async (context) => {
      calls.survey.push(context)
      return responses.survey ?? { candidates: [] }
    },
    generateAdrDraft: async (context) => {
      calls.draft.push(context)
      const resp = responses.drafts?.get(context.topic)
      if (!resp) throw new Error(`no canned draft for topic=${context.topic}`)
      if (resp instanceof Error) throw resp
      return resp
    },
    generateServiceViolations: notImpl('generateServiceViolations'),
    generateDatabaseViolations: notImpl('generateDatabaseViolations'),
    generateModuleViolations: notImpl('generateModuleViolations'),
    generateAllViolations: notImpl('generateAllViolations'),
    generateAllViolationsWithLifecycle: notImpl('generateAllViolationsWithLifecycle'),
    generateCodeViolations: notImpl('generateCodeViolations'),
    generateAllCodeViolations: notImpl('generateAllCodeViolations'),
    enrichFlow: notImpl('enrichFlow'),
    setAnalysisId: () => {},
    setRepoId: () => {},
    setRepoPath: () => {},
    setAbortSignal: () => {},
    flushUsage: () => [],
  } as unknown as LLMProvider & {
    calls: { survey: AdrSurveyContext[]; draft: AdrDraftContext[] }
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function emptyGraph(): Graph {
  return {
    services: [],
    serviceDependencies: [],
    layers: [],
    modules: [],
    methods: [],
    moduleDeps: [],
    methodDeps: [],
    databases: [],
    databaseConnections: [],
    flows: [],
  }
}

function graphWithServices(names: string[]): Graph {
  const g = emptyGraph()
  g.services = names.map((name) => ({
    id: `svc-${name}`,
    name,
    rootPath: `/${name}`,
    type: 'api-server',
    framework: 'express',
    fileCount: 10,
    description: null,
    layerSummary: null,
  }))
  return g
}

function makeDraftResult(overrides: Partial<AdrDraftResult> = {}): AdrDraftResult {
  return {
    title: 'A draft',
    madrBody: '# ADR-XXXX: A draft\n\n## Context\nctx\n## Decision\ndec\n## Consequences\ncon',
    topic: 'circular-dependency',
    entities: ['auth-service', 'billing-service'],
    confidence: 0.8,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let repoPath: string

beforeEach(() => {
  repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-adr-suggest-'))
})

afterEach(() => {
  fs.rmSync(repoPath, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('suggestAdrsInProcess — happy path', () => {
  it('runs survey, drafts, validates, and persists', async () => {
    const graph = graphWithServices(['auth-service', 'billing-service'])
    const provider = makeMockProvider({
      survey: {
        candidates: [
          {
            topic: 'circular-dependency',
            entities: ['auth-service', 'billing-service'],
            rationale: 'obvious cycle',
          },
        ],
      },
      drafts: new Map([
        ['circular-dependency', makeDraftResult()],
      ]),
    })

    const events: AdrSuggestEvent[] = []
    const result = await suggestAdrsInProcess({
      repoPath,
      graph,
      existingAdrs: [],
      rejectedSignatures: [],
      provider,
      onProgress: (e) => events.push(e),
    })

    expect(result.surveyCandidateCount).toBe(1)
    expect(result.drafts).toHaveLength(1)
    expect(result.dropped).toEqual([])
    expect(result.drafts[0].topic).toBe('circular-dependency')
    expect(result.drafts[0].id).toMatch(/^draft-[0-9a-f]+$/)

    // Draft file persisted
    const stored = listAdrDrafts(repoPath)
    expect(stored).toHaveLength(1)
    expect(stored[0].id).toBe(result.drafts[0].id)

    // Progress events in order
    expect(events[0].kind).toBe('survey-start')
    expect(events.some((e) => e.kind === 'survey-done')).toBe(true)
    expect(events.some((e) => e.kind === 'draft-start')).toBe(true)
    expect(events.some((e) => e.kind === 'draft-done')).toBe(true)
    expect(events[events.length - 1]).toEqual({ kind: 'complete', accepted: 1, dropped: 0 })
  })
})

// ---------------------------------------------------------------------------
// Filtering at the survey stage (no draft calls made)
// ---------------------------------------------------------------------------

describe('suggestAdrsInProcess — survey filtering', () => {
  it('drops candidates whose topic is outside the vocab', async () => {
    const provider = makeMockProvider({
      survey: {
        candidates: [
          { topic: 'not-a-real-topic', entities: ['auth-service'], rationale: 'r' },
        ],
      },
    })
    const result = await suggestAdrsInProcess({
      repoPath,
      graph: graphWithServices(['auth-service']),
      existingAdrs: [],
      rejectedSignatures: [],
      provider,
    })
    expect(result.drafts).toHaveLength(0)
    expect(result.dropped).toEqual([
      { topic: 'not-a-real-topic', entities: ['auth-service'], reason: 'unknown-topic' },
    ])
    expect(provider.calls.draft).toEqual([])
  })

  it('drops candidates whose entities are not in the graph', async () => {
    const provider = makeMockProvider({
      survey: {
        candidates: [
          { topic: 'circular-dependency', entities: ['ghost-service'], rationale: 'r' },
        ],
      },
    })
    const result = await suggestAdrsInProcess({
      repoPath,
      graph: graphWithServices(['auth-service']),
      existingAdrs: [],
      rejectedSignatures: [],
      provider,
    })
    expect(result.drafts).toHaveLength(0)
    expect(result.dropped[0].reason).toBe('unknown-entities')
    expect(provider.calls.draft).toEqual([])
  })

  it('drops candidates whose signature is already rejected', async () => {
    const rejected: TopicSignature[] = [
      { topic: 'circular-dependency', entities: ['auth-service', 'billing-service'] },
    ]
    const provider = makeMockProvider({
      survey: {
        candidates: [
          {
            topic: 'circular-dependency',
            entities: ['billing-service', 'auth-service'],
            rationale: 'r',
          },
        ],
      },
    })
    const result = await suggestAdrsInProcess({
      repoPath,
      graph: graphWithServices(['auth-service', 'billing-service']),
      existingAdrs: [],
      rejectedSignatures: rejected,
      provider,
    })
    expect(result.drafts).toHaveLength(0)
    expect(result.dropped[0].reason).toBe('rejected-signature')
    expect(provider.calls.draft).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Filtering at the draft stage
// ---------------------------------------------------------------------------

describe('suggestAdrsInProcess — draft filtering', () => {
  it('drops drafts below the confidence threshold', async () => {
    const provider = makeMockProvider({
      survey: {
        candidates: [
          { topic: 'circular-dependency', entities: ['auth-service'], rationale: 'r' },
        ],
      },
      drafts: new Map([
        ['circular-dependency', makeDraftResult({ entities: ['auth-service'], confidence: 0.3 })],
      ]),
    })
    const result = await suggestAdrsInProcess({
      repoPath,
      graph: graphWithServices(['auth-service']),
      existingAdrs: [],
      rejectedSignatures: [],
      threshold: 0.5,
      provider,
    })
    expect(result.drafts).toHaveLength(0)
    expect(result.dropped[0].reason).toBe('below-threshold')
  })

  it('drops drafts whose refined entities leave the graph', async () => {
    const provider = makeMockProvider({
      survey: {
        candidates: [
          { topic: 'circular-dependency', entities: ['auth-service'], rationale: 'r' },
        ],
      },
      drafts: new Map([
        ['circular-dependency', makeDraftResult({ entities: ['ghost-service'] })],
      ]),
    })
    const result = await suggestAdrsInProcess({
      repoPath,
      graph: graphWithServices(['auth-service']),
      existingAdrs: [],
      rejectedSignatures: [],
      provider,
    })
    expect(result.drafts).toHaveLength(0)
    expect(result.dropped[0].reason).toBe('unknown-entities')
  })

  it('records failed draft calls as draft-failed, not a thrown error', async () => {
    const provider = makeMockProvider({
      survey: {
        candidates: [
          { topic: 'circular-dependency', entities: ['auth-service'], rationale: 'r' },
        ],
      },
      drafts: new Map([
        ['circular-dependency', new Error('CLI exploded')],
      ]),
    })
    const result = await suggestAdrsInProcess({
      repoPath,
      graph: graphWithServices(['auth-service']),
      existingAdrs: [],
      rejectedSignatures: [],
      provider,
    })
    expect(result.drafts).toHaveLength(0)
    expect(result.dropped[0].reason).toBe('draft-failed')
  })

  it('drops drafts whose refined signature matches a rejected one', async () => {
    const rejected: TopicSignature[] = [
      { topic: 'circular-dependency', entities: ['auth-service', 'billing-service'] },
    ]
    const provider = makeMockProvider({
      survey: {
        candidates: [
          // Passes survey filter: entities differ from rejected set.
          { topic: 'circular-dependency', entities: ['auth-service'], rationale: 'r' },
        ],
      },
      drafts: new Map([
        // But the draft refines entities to match the rejected signature.
        ['circular-dependency', makeDraftResult({ entities: ['billing-service', 'auth-service'] })],
      ]),
    })
    const result = await suggestAdrsInProcess({
      repoPath,
      graph: graphWithServices(['auth-service', 'billing-service']),
      existingAdrs: [],
      rejectedSignatures: rejected,
      provider,
    })
    expect(result.drafts).toHaveLength(0)
    expect(result.dropped[0].reason).toBe('rejected-signature')
  })
})

// ---------------------------------------------------------------------------
// Limits + misc
// ---------------------------------------------------------------------------

describe('suggestAdrsInProcess — caps and limits', () => {
  it('respects maxDrafts by truncating survey candidates', async () => {
    const provider = makeMockProvider({
      survey: {
        candidates: [
          { topic: 'circular-dependency', entities: ['s1'], rationale: 'r' },
          { topic: 'shared-database', entities: ['s2'], rationale: 'r' },
          { topic: 'facade-module', entities: ['s3'], rationale: 'r' },
        ],
      },
      drafts: new Map([
        ['circular-dependency', makeDraftResult({ topic: 'circular-dependency', entities: ['s1'] })],
        ['shared-database', makeDraftResult({ topic: 'shared-database', entities: ['s2'] })],
      ]),
    })
    const graph = graphWithServices(['s1', 's2', 's3'])
    const result = await suggestAdrsInProcess({
      repoPath,
      graph,
      existingAdrs: [],
      rejectedSignatures: [],
      maxDrafts: 2,
      provider,
    })
    // Only first 2 survivors become draft calls.
    expect(provider.calls.draft).toHaveLength(2)
    expect(result.drafts).toHaveLength(2)
  })

  it('passes the graph summary and topic hint to the survey call', async () => {
    const provider = makeMockProvider({ survey: { candidates: [] } })
    await suggestAdrsInProcess({
      repoPath,
      graph: graphWithServices(['svc-a']),
      existingAdrs: [],
      rejectedSignatures: [],
      topicHint: 'focus on the data layer',
      provider,
    })
    expect(provider.calls.survey[0].topicHint).toBe('focus on the data layer')
    expect(provider.calls.survey[0].graphSummary).toContain('svc-a')
  })

  // M10 — flows are surfaced in the graph summary so the LLM can ground
  // communication-pattern / service-boundary drafts in real step sequences.
  it('includes flows in the graph summary when the graph has flows', async () => {
    const graph = graphWithServices(['auth-service', 'billing-service'])
    graph.flows = [
      {
        id: 'flow-1',
        name: 'user-registration',
        description: null,
        entryService: 'auth-service',
        entryMethod: 'register',
        category: 'auth',
        trigger: 'http',
        stepCount: 2,
        steps: [
          {
            stepOrder: 1,
            sourceService: 'auth-service',
            sourceModule: 'auth',
            sourceMethod: 'register',
            targetService: 'billing-service',
            targetModule: 'billing',
            targetMethod: 'createAccount',
            stepType: 'http',
            dataDescription: null,
            isAsync: false,
            isConditional: false,
          },
          {
            stepOrder: 2,
            sourceService: 'billing-service',
            sourceModule: 'billing',
            sourceMethod: 'createAccount',
            targetService: 'auth-service',
            targetModule: 'auth',
            targetMethod: 'finalize',
            stepType: 'call',
            dataDescription: null,
            isAsync: false,
            isConditional: false,
          },
        ],
      },
    ]

    const provider = makeMockProvider({ survey: { candidates: [] } })
    await suggestAdrsInProcess({
      repoPath,
      graph,
      existingAdrs: [],
      rejectedSignatures: [],
      provider,
    })
    const summary = provider.calls.survey[0].graphSummary
    expect(summary).toContain('Flows (1)')
    expect(summary).toContain('user-registration [http]')
    expect(summary).toContain('auth-service → billing-service (http)')
    expect(summary).toContain('billing-service → auth-service (call)')
  })

  // M12 — LLM-emitted fragment blocks are validated post-draft. Valid
  // blocks pass through; invalid ones are stripped from the body while
  // the surrounding prose is preserved.
  it('keeps valid adr-graph blocks in the persisted draft body', async () => {
    const graph = graphWithServices(['auth-service', 'billing-service'])
    const provider = makeMockProvider({
      survey: {
        candidates: [
          {
            topic: 'circular-dependency',
            entities: ['auth-service', 'billing-service'],
            rationale: 'cycle',
          },
        ],
      },
      drafts: new Map([
        [
          'circular-dependency',
          makeDraftResult({
            madrBody:
              '## Context\nSome context.\n\n' +
              '```adr-graph\nservices: [auth-service, billing-service]\n```\n\n' +
              '## Decision\nAccept.\n\n## Consequences\nOps increase.\n',
          }),
        ],
      ]),
    })
    const result = await suggestAdrsInProcess({
      repoPath,
      graph,
      existingAdrs: [],
      rejectedSignatures: [],
      provider,
    })
    expect(result.drafts).toHaveLength(1)
    expect(result.drafts[0].madrBody).toContain('```adr-graph')
    expect(result.drafts[0].madrBody).toContain('services: [auth-service, billing-service]')
  })

  it('strips invalid adr-graph blocks but keeps the surrounding prose', async () => {
    const graph = graphWithServices(['real-service'])
    const provider = makeMockProvider({
      survey: {
        candidates: [
          { topic: 'circular-dependency', entities: ['real-service'], rationale: 'r' },
        ],
      },
      drafts: new Map([
        [
          'circular-dependency',
          makeDraftResult({
            entities: ['real-service'],
            madrBody:
              '## Context\nIntro prose.\n\n' +
              '```adr-graph\nservices: [ghost-service]\n```\n\n' +
              'Continuing prose.\n\n## Decision\nD.\n\n## Consequences\nC.\n',
          }),
        ],
      ]),
    })
    const result = await suggestAdrsInProcess({
      repoPath,
      graph,
      existingAdrs: [],
      rejectedSignatures: [],
      provider,
    })
    expect(result.drafts).toHaveLength(1)
    const body = result.drafts[0].madrBody
    expect(body).not.toContain('```adr-graph')
    expect(body).not.toContain('ghost-service')
    // Prose before + after the stripped block is preserved
    expect(body).toContain('Intro prose.')
    expect(body).toContain('Continuing prose.')
    expect(body).toContain('## Decision')
  })

  it('strips invalid adr-flow blocks with unknown flowId', async () => {
    const graph = graphWithServices(['s'])
    const provider = makeMockProvider({
      survey: {
        candidates: [
          { topic: 'communication-pattern', entities: ['s'], rationale: 'r' },
        ],
      },
      drafts: new Map([
        [
          'communication-pattern',
          makeDraftResult({
            topic: 'communication-pattern',
            entities: ['s'],
            madrBody:
              '## Context\nText.\n\n```adr-flow\nflowId: ghost-flow\n```\n\n## Decision\nD.\n\n## Consequences\nC.\n',
          }),
        ],
      ]),
    })
    const result = await suggestAdrsInProcess({
      repoPath,
      graph,
      existingAdrs: [],
      rejectedSignatures: [],
      provider,
    })
    expect(result.drafts).toHaveLength(1)
    expect(result.drafts[0].madrBody).not.toContain('```adr-flow')
    expect(result.drafts[0].madrBody).not.toContain('ghost-flow')
  })

  it('caps flows at top-15 by step count in the graph summary', async () => {
    const graph = graphWithServices(['a'])
    graph.flows = Array.from({ length: 20 }, (_, i) => ({
      id: `flow-${i}`,
      name: `flow-${i}`,
      description: null,
      entryService: 'a',
      entryMethod: 'entry',
      category: 'misc',
      trigger: 'http' as const,
      stepCount: i,
      steps: [],
    }))

    const provider = makeMockProvider({ survey: { candidates: [] } })
    await suggestAdrsInProcess({
      repoPath,
      graph,
      existingAdrs: [],
      rejectedSignatures: [],
      provider,
    })
    const summary = provider.calls.survey[0].graphSummary
    expect(summary).toContain('Flows (20, showing top 15 by step count)')
    // Top-15 by step count → flow-5 … flow-19 included; flow-0 excluded.
    expect(summary).toContain('flow-19')
    expect(summary).not.toMatch(/- flow-0 \[/)
    expect(summary).not.toMatch(/- flow-4 \[/)
  })
})
