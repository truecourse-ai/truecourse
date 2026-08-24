/**
 * PARTIAL COVERAGE — a flow whose milestones are not all testable must not be
 * held hostage whole. The worker session settles the satisfiable subset and names
 * each blocked milestone's blocker (`blockedMilestones` on a `settled` outcome);
 * the engine records the split on the wire shape every read surface renders:
 *  - the field case: a partial settle commits `<flow>.cli.1` with its covered
 *    `milestones` recorded, plus a sibling milestone-scoped `blocked-on` gap;
 *  - the dependency rule: a milestone dependent on a blocked prerequisite is
 *    named blocked alongside it, and the engine records the transitive split;
 *  - the unblock path: a recipe change re-authors and the scenario GROWS under
 *    the same `.1` identity;
 *  - the replay: a settled split re-serves from the authoring cache with ZERO
 *    turns, split intact;
 *  - the whole-flow outcomes: a `blocked` settle lands the whole-flow gap guard
 *    always produced, and a fully-satisfiable flow keeps no milestone bookkeeping
 *    at all.
 */

import { describe, it, expect, afterEach } from 'vitest'
import type { FidelityUserContext, RawGeneratedScenario } from '@truecourse/guard-generator'
import { readManifest, writeManifest } from '@truecourse/guard-runner'
import {
  GuardGenerateReportSchema,
  GUARD_FORMAT_VERSION,
  parseBlockedOnCapabilities,
} from '@truecourse/shared'
import type { LlmTurnFn, LlmTurnRequest } from '@truecourse/shared/llm'
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
  turnReply,
  workerTurnBy,
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
const FLOW_TITLE = 'set up guard and generate'
/** The id synthesis derives from {@link FLOW_TITLE} — the key a session is scripted by. */
const FLOW_ID = 'set-up-guard-and-generate'

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
 * A worker session that settles PARTIAL: it drafts each scenario in turn (a draft
 * whose run fails is revised with the next one), and settles the covered subset
 * naming `blockedMilestones` once a run passes. The engine's settle gate accepts
 * it only when the drafts realize exactly the non-blocked milestones.
 */
function partialSession(
  drafts: RawGeneratedScenario[],
  blockedMilestones: { milestone: number; blockedOn: string[] }[],
  onTurn?: (req: LlmTurnRequest) => void,
): LlmTurnFn {
  let drafted = 0
  return async (req) => {
    onTurn?.(req)
    const last = req.messages[req.messages.length - 1]
    if (last?.role === 'user' && last.text.startsWith('run_scenario result:')) {
      if (last.text.includes('"verdict": "pass"')) {
        return turnReply({ outcome: { result: 'settled', blockedMilestones } })
      }
    }
    const scenario = drafts[Math.min(drafted++, drafts.length - 1)]
    return turnReply({ tool: 'run_scenario', args: { scenario } })
  }
}

describe('generateGuards — a partial settle covers the free milestones instead of blocking the flow whole', () => {
  it('commits the free subset and records the blocked milestones as a milestone-scoped gap', async () => {
    const r = repo()
    seedFourClaims(r)
    const fidelityCtxs: FidelityUserContext[] = []

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: fourClaims,
      flowsRunner: flowOfAll(FLOW_TITLE),
      turnFn: partialSession(
        [subsetScenario('the free milestones hold', [1, 3])],
        [
          { milestone: 2, blockedOn: ['anthropic'] },
          { milestone: 4, blockedOn: ['anthropic', 'network'] },
        ],
      ),
      fidelityRunner: async (ctx) => {
        fidelityCtxs.push(ctx)
        return { verdict: 'faithful' }
      },
    })

    // ONE partial scenario, standard `.1` identity, its covered orders recorded.
    expect(res.written).toHaveLength(1)
    const written = res.written[0]
    expect(written.flowId).toBe(FLOW_ID)
    expect(written.id).toMatch(/\.cli\.1$/)
    expect(written.status).toBe('passing')
    expect(written.milestones).toEqual([1, 3])

    // The blocked rest is a milestone-scoped gap: "2 of 4 claims blocked", the
    // nouns still round-tripping through the shared parser.
    const gap = res.coverageGaps.find((g) => g.kind === 'blocked-on')!
    expect(gap.flowId).toBe(written.flowId)
    expect(gap.surface).toBe('cli')
    expect(gap.reason).toContain('2 of 4 claims')
    expect(gap.reason).toContain('the other 2 are covered')
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
      flowsRunner: flowOfAll(FLOW_TITLE),
      turnFn: async () => {
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

    // The session judges milestone 3 dependent on blocked milestone 2's state and
    // blocks it on the SAME capability; the engine records the transitive split.
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: fourClaims,
      flowsRunner: flowOfAll(FLOW_TITLE),
      turnFn: partialSession(
        [subsetScenario('the independent milestones hold', [1, 4])],
        [
          { milestone: 2, blockedOn: ['anthropic'] },
          { milestone: 3, blockedOn: ['anthropic'] },
        ],
      ),
    })

    expect(res.written[0].milestones).toEqual([1, 4])
    const gap = res.coverageGaps.find((g) => g.kind === 'blocked-on')!
    expect(gap.blockedMilestones?.map((b) => b.milestone)).toEqual([2, 3])
    expect(parseBlockedOnCapabilities(gap.reason)).toEqual(['anthropic'])
  })

  it('converges a failing draft against the COVERED subset before settling the split', async () => {
    const r = repo()
    seedFourClaims(r)

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: fourClaims,
      flowsRunner: flowOfAll(FLOW_TITLE),
      turnFn: partialSession(
        [
          // The first draft realizes the right subset but asserts the wrong exit
          // (`boom` exits 7), so the session reads the capture and revises.
          raw('a broken partial', [
            { run: ['boom'], expect: { exit: 0 }, milestone: 1 },
            { run: ['--version'], expect: { exit: 0 }, milestone: 3 },
          ]),
          subsetScenario('the fixed partial', [1, 3]),
        ],
        [
          { milestone: 2, blockedOn: ['anthropic'] },
          { milestone: 4, blockedOn: ['anthropic'] },
        ],
      ),
    })

    expect(res.written).toHaveLength(1)
    expect(res.written[0].status).toBe('passing')
    expect(res.written[0].milestones).toEqual([1, 3])
    expect(res.coverageGaps.find((g) => g.kind === 'blocked-on')!.blockedMilestones?.map((b) => b.milestone)).toEqual([
      2, 4,
    ])
  })

  it('re-authors on a recipe change and the scenario GROWS under the same .1 id', async () => {
    const r = repo()
    seedFourClaims(r)
    const first = await runGenerate({
      repoRoot: r,
      extractRunner: fourClaims,
      flowsRunner: flowOfAll(FLOW_TITLE),
      turnFn: partialSession(
        [subsetScenario('the free milestones hold', [1, 3])],
        [
          { milestone: 2, blockedOn: ['anthropic'] },
          { milestone: 4, blockedOn: ['anthropic'] },
        ],
      ),
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
      flowsRunner: flowOfAll(FLOW_TITLE),
      turnFn: partialSession(
        [subsetScenario('three milestones hold now', [1, 2, 3])],
        [{ milestone: 4, blockedOn: ['network'] }],
      ),
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

  it('replays the settled split from the authoring cache with ZERO turns', async () => {
    const r = repo()
    seedFourClaims(r)
    const blocked = [
      { milestone: 2, blockedOn: ['anthropic'] },
      { milestone: 4, blockedOn: ['anthropic'] },
    ]
    await runGenerate({
      repoRoot: r,
      extractRunner: fourClaims,
      flowsRunner: flowOfAll(FLOW_TITLE),
      turnFn: partialSession([subsetScenario('the free milestones hold', [1, 3])], blocked),
    })

    // Reset the manifest so the flow is work again; authoring is a cache HIT —
    // the cached settle carries the split, so it is re-validated against the
    // covered subset and re-recorded without a single turn.
    writeManifest(r, { version: GUARD_FORMAT_VERSION, flows: [] })
    let turns = 0
    const res2 = await runGenerate({
      repoRoot: r,
      extractRunner: fourClaims,
      flowsRunner: flowOfAll(FLOW_TITLE),
      turnFn: partialSession([subsetScenario('the free milestones hold', [1, 3])], blocked, () => turns++),
    })

    expect(turns).toBe(0)
    expect(res2.written).toHaveLength(1)
    expect(res2.written[0].milestones).toEqual([1, 3])
    const gap = res2.coverageGaps.find((g) => g.kind === 'blocked-on')!
    expect(gap.blockedMilestones?.map((b) => b.milestone)).toEqual([2, 4])
    expect(readManifest(r)!.flows[0].scenarios[0].milestones).toEqual([1, 3])
  })
})

describe('generateGuards — the whole-flow outcomes are unchanged', () => {
  it('an all-blocked session settles as the whole-flow gap guard always produced', async () => {
    const r = repo()
    seedFourClaims(r)

    // Every milestone blocked is the `blocked` outcome, not a settle — the
    // per-milestone detail rides along and folds into the whole-flow nouns.
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: fourClaims,
      flowsRunner: flowOfAll(FLOW_TITLE),
      turnFn: workerTurnBy({
        [FLOW_ID]: {
          blockedOn: ['anthropic'],
          blockedMilestones: [1, 2, 3, 4].map((m) => ({ milestone: m, blockedOn: ['anthropic'] })),
        },
      }),
    })

    expect(res.written).toHaveLength(0)
    const gap = res.coverageGaps.find((g) => g.kind === 'blocked-on')!
    expect(gap.reason).toBe(`blocked on anthropic: ${FLOW_TITLE}`)
    expect(gap.blockedMilestones).toBeUndefined()
    expect(res.flows.settled).toBe(1)
  })

  it('a bare refusal with no per-milestone detail settles the same whole-flow gap', async () => {
    const r = repo()
    seedFourClaims(r)

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: fourClaims,
      flowsRunner: flowOfAll(FLOW_TITLE),
      turnFn: workerTurnBy({ [FLOW_ID]: { blockedOn: ['docker'] } }),
    })

    expect(res.written).toHaveLength(0)
    const gap = res.coverageGaps.find((g) => g.kind === 'blocked-on')!
    expect(parseBlockedOnCapabilities(gap.reason)).toEqual(['docker'])
    expect(gap.blockedMilestones).toBeUndefined()
  })

  it('a fully-satisfiable flow keeps no milestone bookkeeping at all', async () => {
    const r = repo()
    seedFourClaims(r)

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: fourClaims,
      flowsRunner: flowOfAll(FLOW_TITLE),
      turnFn: workerTurnBy({}),
    })

    expect(res.written).toHaveLength(1)
    expect(res.written[0].milestones).toBeUndefined()
    expect(res.coverageGaps.filter((g) => g.kind === 'blocked-on')).toHaveLength(0)
    const entry = readManifest(r)!.flows[0]
    expect(entry.scenarios[0].milestones).toBeUndefined()
    expect(entry.gaps).toEqual([])
  })
})
