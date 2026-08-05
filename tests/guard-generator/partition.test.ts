/**
 * PARTITIONED AUTHORING — a whole-flow refusal must not hold the flow's free
 * milestones hostage. The engine follows a refusal with ONE partition call that
 * authors the satisfiable subset and names each blocked milestone's blocker:
 *  - the field-case shape: free + blocked milestones split into a partial
 *    scenario (`<flow>.cli.1`, its `milestones` recorded) plus a milestone-scoped
 *    `blocked-on` gap;
 *  - the dependency rule: a milestone dependent on a blocked prerequisite joins
 *    the blocked subset (the prompt states the rule; the engine records the split);
 *  - the unblock path: a recipe change re-authors and the scenario GROWS under
 *    the same `.1` identity;
 *  - regressions: a fully-satisfiable flow authors exactly as before (no
 *    partition context, byte-identical prompt), and an all-blocked partition
 *    settles as the whole-flow gap guard always produced.
 */

import { describe, it, expect, afterEach } from 'vitest'
import {
  buildAuthorUserPrompt,
  PARTITION_RULES,
  PartitionedFlowScenarioSchema,
  type AuthorUserContext,
  type FidelityUserContext,
  type GenerateRunner,
  type RawGeneratedScenario,
} from '@truecourse/guard-generator'
import { readManifest } from '@truecourse/guard-runner'
import { GuardGenerateReportSchema, parseBlockedOnCapabilities } from '@truecourse/shared'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  extractBy,
  flowOfAll,
  runGenerate,
  raw,
  stampMilestones,
  PASSING_STEPS,
} from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

const DOC = 'docs/guard.md'

/** The field-case doc: four claims in one section — two free, two needing an LLM. */
function seedFourClaims(r: string): void {
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, '## setup\nGenerate refuses before setup; setup proposes a recipe with the LLM.\n')
}

const fourClaims = extractBy({
  setup: [
    { claim: 'generate refuses before setup with guidance' },
    { claim: 'setup proposes a recipe via the LLM' },
    { claim: 'generate stamps scenarios from route files' },
    { claim: 'setup verifies the recipe against the network' },
  ],
})

/** A partial scenario realizing exactly the given milestone orders (passing steps). */
function subsetScenario(title: string, orders: number[]): RawGeneratedScenario {
  return raw(
    title,
    orders.map((m) => ({ run: ['--version'], expect: { exit: 0 }, milestone: m })),
  )
}

/**
 * A runner that refuses the round-1 call and answers the partition call with the
 * given reply; the retry call (birth evidence) answers with `onRetry` when given.
 */
function partitionRunner(
  reply: unknown,
  opts: { refusedOn?: string[]; onRetry?: RawGeneratedScenario; onCall?: (ctx: AuthorUserContext) => void } = {},
): GenerateRunner {
  return async (ctx) => {
    opts.onCall?.(ctx)
    if (ctx.partition) return reply
    if (ctx.retry && opts.onRetry) return { scenario: opts.onRetry }
    return { blockedOn: opts.refusedOn ?? ['anthropic'] }
  }
}

describe('generateGuards — a refusal partitions the flow instead of blocking it whole', () => {
  it('authors the free subset and records the blocked milestones as a milestone-scoped gap', async () => {
    const r = repo()
    seedFourClaims(r)
    const fidelityCtxs: FidelityUserContext[] = []

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: fourClaims,
      flowsRunner: flowOfAll('set up guard and generate'),
      generateRunner: partitionRunner({
        scenario: subsetScenario('the free milestones hold', [1, 3]),
        blockedMilestones: [
          { milestone: 2, blockedOn: ['anthropic'] },
          { milestone: 4, blockedOn: ['anthropic', 'network'] },
        ],
      }),
      fidelityRunner: async (ctx) => {
        fidelityCtxs.push(ctx)
        return { verdict: 'faithful' }
      },
    })

    // ONE partial scenario, standard `.1` identity, its covered orders recorded.
    expect(res.written).toHaveLength(1)
    const written = res.written[0]
    expect(written.id).toMatch(/\.cli\.1$/)
    expect(written.status).toBe('passing')
    expect(written.milestones).toEqual([1, 3])

    // The blocked rest is a milestone-scoped gap: "2 of 4 claims blocked", the
    // nouns still round-tripping through the shared parser.
    const gap = res.coverageGaps.find((g) => g.kind === 'blocked-on')!
    expect(gap.flowId).toBe(written.flowId)
    expect(gap.surface).toBe('cli')
    expect(gap.reason).toContain('2 of 4 claims')
    expect(gap.reason).toContain('the other 2 are tested')
    expect(parseBlockedOnCapabilities(gap.reason)).toEqual(['anthropic', 'network'])
    expect(gap.blockedMilestones).toEqual([
      { milestone: 2, claim: 'setup proposes a recipe via the LLM', blockedOn: ['anthropic'] },
      { milestone: 4, claim: 'setup verifies the recipe against the network', blockedOn: ['anthropic', 'network'] },
    ])

    // The flow SETTLES — partial coverage is a settled outcome, not pending work.
    expect(res.flows.settled).toBe(1)
    expect(res.flows.unsettled).toBe(0)

    // The manifest is the durable record: the scenario carries its covered
    // orders, the gap its blocked milestones — on the same surface.
    const entry = readManifest(r)!.flows.find((f) => f.flowId === written.flowId)!
    expect(entry.generationInputsHash).not.toBeNull()
    expect(entry.scenarios).toHaveLength(1)
    expect(entry.scenarios[0].milestones).toEqual([1, 3])
    expect(entry.gaps).toHaveLength(1)
    expect(entry.gaps[0].blockedMilestones?.map((b) => b.milestone)).toEqual([2, 4])

    // The fidelity reviewer judges the covered subset only, the blocked ones in
    // view so it never flags their absence.
    expect(fidelityCtxs).toHaveLength(1)
    expect(fidelityCtxs[0].milestones.map((m) => m.order)).toEqual([1, 3])
    expect(fidelityCtxs[0].blocked).toEqual([
      { order: 2, blockedOn: ['anthropic'] },
      { order: 4, blockedOn: ['anthropic', 'network'] },
    ])

    // The persisted report's strict schema accepts the new fields.
    expect(GuardGenerateReportSchema.safeParse({ ...res, generatedAt: '2026-08-05T00:00:00Z' }).success).toBe(true)

    // A second, unchanged run is a no-op that keeps the split intact.
    const again = await runGenerate({
      repoRoot: r,
      extractRunner: fourClaims,
      flowsRunner: flowOfAll('set up guard and generate'),
      generateRunner: async () => {
        throw new Error('an unchanged flow must not author')
      },
    })
    expect(again.noChanges).toBe(true)
    expect(again.flows.skipped).toBe(1)
    const carried = readManifest(r)!.flows.find((f) => f.flowId === written.flowId)!
    expect(carried.scenarios[0].milestones).toEqual([1, 3])
    expect(carried.gaps[0].blockedMilestones?.map((b) => b.milestone)).toEqual([2, 4])
    // The carried gap keeps its milestone scoping on the report side too.
    const carriedGap = again.coverageGaps.find((g) => g.kind === 'blocked-on')!
    expect(carriedGap.blockedMilestones?.map((b) => b.milestone)).toEqual([2, 4])
  })

  it('keeps a dependent milestone with its blocked prerequisite in the blocked subset', async () => {
    const r = repo()
    seedFourClaims(r)

    // The model judges milestone 3 dependent on blocked milestone 2's state and
    // blocks it on the SAME capability; the engine records the transitive split.
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: fourClaims,
      flowsRunner: flowOfAll('set up guard and generate'),
      generateRunner: partitionRunner({
        scenario: subsetScenario('the independent milestones hold', [1, 4]),
        blockedMilestones: [
          { milestone: 2, blockedOn: ['anthropic'] },
          { milestone: 3, blockedOn: ['anthropic'] },
        ],
      }),
    })

    expect(res.written[0].milestones).toEqual([1, 4])
    const gap = res.coverageGaps.find((g) => g.kind === 'blocked-on')!
    expect(gap.blockedMilestones?.map((b) => b.milestone)).toEqual([2, 3])
    expect(parseBlockedOnCapabilities(gap.reason)).toEqual(['anthropic'])
  })

  it('re-authors on a recipe change and the scenario GROWS under the same .1 id', async () => {
    const r = repo()
    seedFourClaims(r)
    const first = await runGenerate({
      repoRoot: r,
      extractRunner: fourClaims,
      flowsRunner: flowOfAll('set up guard and generate'),
      generateRunner: partitionRunner({
        scenario: subsetScenario('the free milestones hold', [1, 3]),
        blockedMilestones: [
          { milestone: 2, blockedOn: ['anthropic'] },
          { milestone: 4, blockedOn: ['anthropic'] },
        ],
      }),
    })
    const id = first.written[0].id
    expect(first.written[0].milestones).toEqual([1, 3])

    // Declaring the capability edits the recipe → the fingerprint (and with it
    // the flow's generation-inputs hash and author cache key) moves, the flow
    // re-authors, and this time only milestone 4 stays blocked.
    writeRecipe(r, { build: 'true # anthropic declared' })
    const second = await runGenerate({
      repoRoot: r,
      extractRunner: fourClaims,
      flowsRunner: flowOfAll('set up guard and generate'),
      generateRunner: partitionRunner({
        scenario: subsetScenario('three milestones hold now', [1, 2, 3]),
        blockedMilestones: [{ milestone: 4, blockedOn: ['network'] }],
      }),
    })

    expect(second.written).toHaveLength(1)
    expect(second.written[0].id).toBe(id)
    expect(second.written[0].milestones).toEqual([1, 2, 3])
    const entry = readManifest(r)!.flows.find((f) => f.flowId === second.written[0].flowId)!
    expect(entry.scenarios[0].milestones).toEqual([1, 2, 3])
    expect(entry.gaps[0].blockedMilestones).toEqual([
      { milestone: 4, claim: 'setup verifies the recipe against the network', blockedOn: ['network'] },
    ])
  })

  it('a birth-failing partial scenario retries against its covered subset only', async () => {
    const r = repo()
    seedFourClaims(r)
    const retryCtxs: AuthorUserContext[] = []

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: fourClaims,
      flowsRunner: flowOfAll('set up guard and generate'),
      generateRunner: partitionRunner(
        {
          // Fails birth: `boom` exits 7, the step expects 0.
          scenario: raw('a broken partial', [
            { run: ['boom'], expect: { exit: 0 }, milestone: 1 },
            { run: ['--version'], expect: { exit: 0 }, milestone: 3 },
          ]),
          blockedMilestones: [
            { milestone: 2, blockedOn: ['anthropic'] },
            { milestone: 4, blockedOn: ['anthropic'] },
          ],
        },
        { onRetry: subsetScenario('the fixed partial', [1, 3]), onCall: (ctx) => void (ctx.retry && retryCtxs.push(ctx)) },
      ),
    })

    // The retry authored the SUBSET (validated against it, not the whole flow)…
    expect(res.written).toHaveLength(1)
    expect(res.written[0].status).toBe('passing')
    expect(res.written[0].milestones).toEqual([1, 3])
    // …and its prompt kept the settled split in view.
    expect(retryCtxs.length).toBeGreaterThan(0)
    expect(retryCtxs[0].blockedMilestones).toEqual([
      { milestone: 2, blockedOn: ['anthropic'] },
      { milestone: 4, blockedOn: ['anthropic'] },
    ])
    expect(retryCtxs[0].partition).toBeUndefined()
  })
})

describe('generateGuards — the whole-flow outcomes are unchanged', () => {
  it('an all-blocked partition settles as the whole-flow gap guard always produced', async () => {
    const r = repo()
    seedFourClaims(r)

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: fourClaims,
      flowsRunner: flowOfAll('set up guard and generate'),
      generateRunner: partitionRunner({
        scenario: null,
        blockedMilestones: [1, 2, 3, 4].map((m) => ({ milestone: m, blockedOn: ['anthropic'] })),
      }),
    })

    expect(res.written).toHaveLength(0)
    const gap = res.coverageGaps.find((g) => g.kind === 'blocked-on')!
    expect(gap.reason).toBe('blocked on anthropic: set up guard and generate')
    expect(gap.blockedMilestones).toBeUndefined()
    expect(res.flows.settled).toBe(1)
  })

  it('tolerates a partition reply in the round-1 refusal shape', async () => {
    const r = repo()
    seedFourClaims(r)

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: fourClaims,
      flowsRunner: flowOfAll('set up guard and generate'),
      generateRunner: partitionRunner({ blockedOn: ['docker'] }, { refusedOn: ['docker'] }),
    })

    expect(res.written).toHaveLength(0)
    const gap = res.coverageGaps.find((g) => g.kind === 'blocked-on')!
    expect(parseBlockedOnCapabilities(gap.reason)).toEqual(['docker'])
  })

  it('a fully-satisfiable flow authors with NO partition context and no milestone bookkeeping', async () => {
    const r = repo()
    seedFourClaims(r)
    const ctxs: AuthorUserContext[] = []

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: fourClaims,
      flowsRunner: flowOfAll('set up guard and generate'),
      generateRunner: async (ctx) => {
        ctxs.push(ctx)
        return { scenario: stampMilestones(raw('all four hold', PASSING_STEPS), ctx.milestones.length) }
      },
    })

    expect(res.written).toHaveLength(1)
    expect(res.written[0].milestones).toBeUndefined()
    expect(res.coverageGaps.filter((g) => g.kind === 'blocked-on')).toHaveLength(0)
    const entry = readManifest(r)!.flows[0]
    expect(entry.scenarios[0].milestones).toBeUndefined()
    // Exactly one authoring call, whose prompt renders neither partition block.
    expect(ctxs).toHaveLength(1)
    expect(ctxs[0].partition).toBeUndefined()
    expect(ctxs[0].blockedMilestones).toBeUndefined()
    const prompt = buildAuthorUserPrompt(ctxs[0])
    expect(prompt).not.toContain('PARTITION')
    expect(prompt).not.toContain('BLOCKED MILESTONES')
  })
})

describe('the partition prompt and reply contract', () => {
  it('renders the refusal nouns, the dependency rule, and the output shape', () => {
    expect(PARTITION_RULES).toContain('DEPENDENCY RULE')
    expect(PARTITION_RULES).toContain('Never assert')
    expect(PARTITION_RULES).toContain('"blockedMilestones"')

    const ctx: AuthorUserContext = {
      flow: { id: 'f', title: 'f', goal: 'g' },
      milestones: [],
      journeyPath: [],
      areaTags: [],
      driver: 'cli',
      recipeEntry: ['node', 'cli.js'],
      recipeBuild: 'true',
      partition: { blockedOn: ['anthropic', 'docker'] },
    }
    const prompt = buildAuthorUserPrompt(ctx)
    expect(prompt).toContain('PARTITION — a scenario walking ALL milestones was refused, blocked on: anthropic, docker.')
    expect(prompt).toContain(PARTITION_RULES)
  })

  it('renders the settled split for a retry of a partial scenario', () => {
    const ctx: AuthorUserContext = {
      flow: { id: 'f', title: 'f', goal: 'g' },
      milestones: [],
      journeyPath: [],
      areaTags: [],
      driver: 'cli',
      recipeEntry: ['node', 'cli.js'],
      recipeBuild: 'true',
      blockedMilestones: [{ milestone: 2, blockedOn: ['anthropic'] }],
    }
    const prompt = buildAuthorUserPrompt(ctx)
    expect(prompt).toContain('BLOCKED MILESTONES')
    expect(prompt).toContain('- milestone 2: blocked on anthropic')
    expect(prompt).not.toContain('PARTITION —')
  })

  it('parses the reply shapes and rejects an empty one', () => {
    const partial = PartitionedFlowScenarioSchema.safeParse({
      scenario: { title: 't', driver: 'cli', steps: [{ run: ['x'], expect: { exit: 0 }, milestone: 1 }] },
      blockedMilestones: [{ milestone: 2, blockedOn: ['anthropic'] }],
    })
    expect(partial.success).toBe(true)
    if (partial.success) expect(partial.data.blockedMilestones).toEqual([{ milestone: 2, blockedOn: ['anthropic'] }])

    const allBlocked = PartitionedFlowScenarioSchema.safeParse({
      scenario: null,
      blockedMilestones: [{ milestone: 1, blockedOn: ['anthropic'] }],
    })
    expect(allBlocked.success).toBe(true)

    const legacy = PartitionedFlowScenarioSchema.safeParse({ blockedOn: ['anthropic'] })
    expect(legacy.success).toBe(true)
    if (legacy.success) expect(legacy.data.blockedOn).toEqual(['anthropic'])

    expect(PartitionedFlowScenarioSchema.safeParse({}).success).toBe(false)
    expect(PartitionedFlowScenarioSchema.safeParse({ blockedMilestones: [] }).success).toBe(false)
  })
})
