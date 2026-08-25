/**
 * The pre-flight estimate for `guard generate` after the session cut-over (plan
 * 04 step 20). Every LLM stage but realization matching and recipe discovery is
 * an agent SESSION, so the estimate is session math: per kind, `items` × the
 * kind's expected turns, floored at one turn per item and ceilinged at the
 * budget's hard limit — and `items` is probed against the SAME caches with the
 * SAME key builders the run uses, which is the property these cases exist to
 * pin. An estimate that quotes a key the run does not probe is a lie in both
 * directions (work promised that never runs, spend that was never quoted).
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runnableDriverIds } from '@truecourse/shared'
import { WRAP_UP_TURNS } from '../../packages/agent-loop/src/index'
import { setCacheEntry } from '@truecourse/llm'
import { estimateGuardTokens } from '../../packages/core/src/services/llm/spec-estimate.js'
import {
  EXTRACT_SESSION_CACHE_NAME,
  EXTRACT_SESSION_BUDGET,
  EXTRACT_SESSION_KIND,
  extractSessionCacheKey,
  FLOWS_SESSION_CACHE_NAME,
  FLOWS_SESSION_KIND,
  FLOW_WORKER_SESSION_KIND,
  FLOW_WORKER_BUDGET,
  FIDELITY_SESSION_KIND,
  flowsSessionCacheKey,
} from '../../packages/core/src/services/guard-generate/index.js'
import {
  planGuardWork,
  collectWorkDocs,
  type FlowSynthesisArea,
} from '@truecourse/guard-generator'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  runGenerate,
  flowStageSeams,
  extractSessionBy,
  flowsAreaSessionOf,
  submitWorkerSessions,
  cliInterface,
  writeInterfaceSnapshot,
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

const DOC = 'docs/cli.md'
const DOC_CONTENT = [
  '## version',
  '`relkit --version` prints the version and exits 0.',
  '',
  '## background',
  'Design history; nothing externally observable here.',
].join('\n')

const AUTH_DOC = 'docs/auth.md'
const AUTH_CONTENT = ['## signin', '`relkit login` stores the token and exits 0.'].join('\n')

/** The full stub-seam pipeline: one flow per claim, one passing scenario each. */
const extract = extractSessionBy({ background: { untestable: 'bg' } })
const worker = submitWorkerSessions(() => raw('v', PASSING_STEPS))

/** A repo with a recipe, a one-doc corpus, and nothing generated yet. */
function coldRepo(): string {
  const r = repo()
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, DOC_CONTENT)
  return r
}

const stagesOf = async (r: string) =>
  new Map(((await estimateGuardTokens(r)).stages ?? []).map((s) => [s.stage, s]))

/**
 * Warm the `guard/extract-session` cache with EXACTLY what the run's extraction
 * seam answers — driven through the seam itself, so the claim inventory the
 * estimate reconstructs offline is byte-identical to the run's. Anything less
 * would compare the estimate against a different corpus than the run sees, which
 * is the one thing these key-parity cases exist to rule out.
 */
async function warmExtractCache(r: string): Promise<void> {
  const plan = planGuardWork(r)
  const docs = collectWorkDocs(r, { ...plan, work: plan.sections })
  const { byDoc } = await extract({ docs })
  for (const doc of docs) {
    const result = byDoc.get(doc.doc)
    if (!result?.ok) continue
    await setCacheEntry(r, EXTRACT_SESSION_CACHE_NAME, extractSessionCacheKey(doc), {
      claims: result.data.claims.map((c) => ({
        claim: c.claim,
        driver: c.driver,
        sectionAnchor: c.sectionAnchor,
        reason: c.reason,
        needs: c.needs ?? [],
      })),
      untestable: result.data.untestable,
    })
  }
}

/** Run the full stub-seam pipeline and warm BOTH session caches the way the real
 *  seams would — the "unchanged repo" state a re-run must walk for free. */
async function generateAndWarm(r: string) {
  const areas: FlowSynthesisArea[] = []
  const seams = flowStageSeams(r)
  const result = await runGenerate({
    repoRoot: r,
    ...seams,
    extractSession: extract,
    flowsAreaSession: async (input) => {
      areas.push(...input.areas)
      return seams.flowsAreaSession(input)
    },
    flowWorkerSession: worker,
  })
  await warmExtractCache(r)
  for (const area of areas) {
    await setCacheEntry(r, FLOWS_SESSION_CACHE_NAME, flowsSessionCacheKey(area), {
      flows: [],
      noFlowClaims: [],
    })
  }
  return result
}

// ---------------------------------------------------------------------------
// Session math: items, expected turns, and the budget ceiling.
// ---------------------------------------------------------------------------

describe('estimateGuardTokens — the session stages', () => {
  it('quotes one extract SESSION per doc: min = items, max = the budget ceiling', async () => {
    const r = coldRepo()

    const stages = await stagesOf(r)
    const extractStage = stages.get(EXTRACT_SESSION_KIND)!
    // One doc in the universe, none cached: one session. The range is TURNS —
    // floored at one per session, ceilinged at the budget's hard limit.
    const ceiling = (EXTRACT_SESSION_BUDGET.maxResumes + 1) * EXTRACT_SESSION_BUDGET.turns + WRAP_UP_TURNS
    expect(ceiling).toBe(23)
    expect(extractStage.callsRange).toEqual({ low: 1, high: 1 * ceiling })
    expect(extractStage.label).toBe('Extracting claims')
    expect(extractStage.bound).toBe('1 of 1 doc changed')
    // The retired one-shot stage ids are gone from the quote entirely.
    for (const retired of ['guardExtract', 'guardFlows', 'guardAuthor', 'guardRetry', 'guardTriage', 'guardFidelity']) {
      expect(stages.has(retired)).toBe(false)
    }
  })

  it('prices the workers at every flow on every surface, at their budget ceiling', async () => {
    const r = coldRepo()

    const stages = await stagesOf(r)
    const workerStage = stages.get(FLOW_WORKER_SESSION_KIND)!
    // Cold: the flow count is a synthesis output, bounded by the runnable claims
    // (2 sections × 3.5) over the recipe's one prepared surface (cli).
    const boundFlows = Math.ceil(2 * 3.5)
    const ceiling = (FLOW_WORKER_BUDGET.maxResumes + 1) * FLOW_WORKER_BUDGET.turns + WRAP_UP_TURNS
    expect(ceiling).toBe(53)
    expect(workerStage.callsRange).toEqual({ low: boundFlows, high: boundFlows * 1 * ceiling })
    expect(workerStage.bound).toContain('flows ≤ runnable claims')
    // The fidelity CHILD is 0..one per worker, at ITS budget's ceiling (5 turns).
    const fidelity = stages.get(FIDELITY_SESSION_KIND)!
    expect(fidelity.callsRange).toEqual({ low: 0, high: boundFlows * (5 + WRAP_UP_TURNS) })
    expect(fidelity.bound).toBe('one review per green submission')
  })

  it('adds a recipe-discovery call only when no recipe.json exists', async () => {
    const withRecipe = coldRepo()
    expect((await stagesOf(withRecipe)).has('guardRecipe')).toBe(false)

    const bare = repo()
    writeCorpus(bare, [{ ref: DOC }])
    writeDoc(bare, DOC, DOC_CONTENT)
    expect((await stagesOf(bare)).get('guardRecipe')!.calls).toBe(1)
  })

  it('quotes one flows session per area, plus the epic ceiling', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [
      { ref: DOC, areaTags: ['cli'] },
      { ref: AUTH_DOC, areaTags: ['auth'] },
    ])
    writeDoc(r, DOC, DOC_CONTENT)
    writeDoc(r, AUTH_DOC, AUTH_CONTENT)

    const stage = (await stagesOf(r)).get(FLOWS_SESSION_KIND)!
    expect(stage.label).toBe('Synthesizing flows')
    // Two areas + at most one epic pass (the epic key hashes the areas' OUTPUT
    // digests, unknowable offline). Expected = 3 sessions × 4 turns; the floor is
    // one turn per area session, the ceiling all three at the budget's limit.
    expect(stage.calls).toBe(3 * 4)
    expect(stage.callsRange).toEqual({ low: 2, high: 3 * 27 })
  })

  it('a single-area repo needs no epic pass', async () => {
    const stage = (await stagesOf(coldRepo())).get(FLOWS_SESSION_KIND)!
    expect(stage.calls).toBe(1 * 4)
    expect(stage.callsRange).toEqual({ low: 1, high: 27 })
  })
})

// ---------------------------------------------------------------------------
// Cache awareness — the estimate probes the REAL keys.
// ---------------------------------------------------------------------------

describe('estimateGuardTokens — cache awareness', () => {
  it('a warm extract-session cache drops extraction and makes the flows count exact', async () => {
    const r = coldRepo()
    expect((await stagesOf(r)).get(FLOWS_SESSION_KIND)!.bound).toBe(
      'flows ≤ runnable claims — flow count is a synthesis output',
    )

    await warmExtractCache(r)

    const stages = await stagesOf(r)
    // Zero items ⇒ the stage vanishes from the quote entirely.
    expect(stages.has(EXTRACT_SESSION_KIND)).toBe(false)
    // The claim inventory is now knowable offline, so the flows bound carries it.
    expect(stages.get(FLOWS_SESSION_KIND)!.bound).toContain('(1 today)')
  })

  it('the flows key the estimate probes is the key the run’s seam would use', async () => {
    const r = coldRepo()
    await warmExtractCache(r)
    expect((await stagesOf(r)).get(FLOWS_SESSION_KIND)!.callsRange).toEqual({ low: 1, high: 27 })

    // The areas the RUN hands its synthesis seam — the seam keys on exactly these.
    const areas: FlowSynthesisArea[] = []
    await runGenerate({
      repoRoot: r,
      ...flowStageSeams(r),
      extractSession: extract,
      flowsAreaSession: flowsAreaSessionOf((area) => {
        areas.push(area)
        return { flows: [], noFlowClaims: [] }
      }),
      stopAfterFlows: true,
    })
    expect(areas).toHaveLength(1)

    // Answer that key in the cache; the estimate must count it as a hit.
    await setCacheEntry(r, FLOWS_SESSION_CACHE_NAME, flowsSessionCacheKey(areas[0]), {
      flows: [],
      noFlowClaims: [],
    })
    expect((await stagesOf(r)).has(FLOWS_SESSION_KIND)).toBe(false)
  })

  it('a dismissed claim re-keys the area for the estimate exactly as it does for the run', async () => {
    const r = coldRepo()
    await warmExtractCache(r)

    const areaFor = async (): Promise<FlowSynthesisArea> => {
      const areas: FlowSynthesisArea[] = []
      await runGenerate({
        repoRoot: r,
        ...flowStageSeams(r),
        extractSession: extract,
        flowsAreaSession: flowsAreaSessionOf((area) => {
          areas.push(area)
          return { flows: [], noFlowClaims: [] }
        }),
        stopAfterFlows: true,
      })
      return areas[0]
    }
    const before = await areaFor()
    await setCacheEntry(r, FLOWS_SESSION_CACHE_NAME, flowsSessionCacheKey(before), {
      flows: [],
      noFlowClaims: [],
    })
    expect((await stagesOf(r)).has(FLOWS_SESSION_KIND)).toBe(false)

    // Dismiss the area's one claim: the run's area material changes, so its key
    // changes, so the previously-cached area is a MISS again.
    fs.writeFileSync(
      path.join(r, '.truecourse', 'scenarios', 'decisions.json'),
      JSON.stringify({
        version: 1,
        dismissedClaims: [
          { doc: DOC, anchor: 'version', title: 'version claim', dismissedAt: '2026-01-01T00:00:00Z' },
        ],
        dismissedFlows: [],
      }),
    )

    const after = await areaFor()
    expect(flowsSessionCacheKey(after)).not.toBe(flowsSessionCacheKey(before))
    expect((await stagesOf(r)).get(FLOWS_SESSION_KIND)!.callsRange).toEqual({ low: 1, high: 27 })
  })

  it('after a full generate nothing is left to do ⇒ the estimate is empty and the confirm is skipped', async () => {
    const r = coldRepo()

    const first = await generateAndWarm(r)
    expect(first.written).toHaveLength(1)

    const est = await estimateGuardTokens(r)
    expect(est.stages).toEqual([])
    expect(est.totalEstimatedTokens).toBe(0)
    // `background` states no claim, so no flow binds it: it counts as an
    // unguarded section forever, which is honest.
    expect(est.subjectLabel).toBe('1 of 2 sections changed')

    const second = await runGenerate({
      repoRoot: r,
      ...flowStageSeams(r),
      extractSession: extract,
      flowWorkerSession: worker,
    })
    expect(second.noChanges).toBe(true)
    expect(second.written).toEqual([])
  })

  it('a moved interface re-matches and re-works exactly the flow that grounds on it', async () => {
    const r = coldRepo()
    await generateAndWarm(r)
    expect((await estimateGuardTokens(r)).stages).toEqual([])

    // The cli surface MOVED (the command gained a flag): the catalog fingerprint
    // changes ⇒ the match cache misses ⇒ one match call and one worker session.
    writeInterfaceSnapshot(r, [cliInterface(['relkit'], ['--json']), cliInterface(['relkit', 'boom'])])

    const stages = await stagesOf(r)
    expect(stages.get('guardMatch')!.calls).toBe(1)
    expect(stages.get(FLOW_WORKER_SESSION_KIND)!.callsRange).toEqual({ low: 1, high: 53 })
    // Nothing spec-side moved, so extraction and synthesis stay silent.
    expect(stages.has(EXTRACT_SESSION_KIND)).toBe(false)
    expect(stages.has(FLOWS_SESSION_KIND)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Estimate/runtime symmetry: whatever the run spends was quoted first.
// ---------------------------------------------------------------------------

describe('estimateGuardTokens — estimate/runtime symmetry', () => {
  it('every session kind the run starts was quoted by the estimate first', async () => {
    const r = coldRepo()
    const quoted = new Set(((await estimateGuardTokens(r)).stages ?? []).map((s) => s.stage))

    const started = new Set<string>()
    await runGenerate({
      repoRoot: r,
      ...flowStageSeams(r),
      extractSession: async (input) => {
        started.add(EXTRACT_SESSION_KIND)
        return extract(input)
      },
      flowsAreaSession: async (input) => {
        started.add(FLOWS_SESSION_KIND)
        return flowStageSeams(r).flowsAreaSession(input)
      },
      matchRunner: async (ctx) => {
        started.add('guardMatch')
        return { plan: ctx.milestones.map((m) => ({ interfaceId: ctx.interfaces[0].id, milestone: m.order })) }
      },
      flowWorkerSession: async (input) => {
        started.add(FLOW_WORKER_SESSION_KIND)
        return worker(input)
      },
    })

    expect(started.size).toBeGreaterThan(0)
    for (const kind of started) expect(quoted.has(kind)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The surfaces a MISSING recipe is priced on — discovery is about to run, so the
// estimate asks the SAME deterministic proposer it will.
// ---------------------------------------------------------------------------

describe('estimateGuardTokens — the surfaces a missing recipe is priced on', () => {
  function repoWithPackage(pkg: Record<string, unknown>, files: Record<string, string> = {}): string {
    const r = repo()
    fs.writeFileSync(path.join(r, 'package.json'), JSON.stringify(pkg, null, 2))
    for (const [rel, content] of Object.entries(files)) fs.writeFileSync(path.join(r, rel), content)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)
    return r
  }

  /** The surface count the realization stages quote in their bound line. */
  async function pricedSurfaces(r: string): Promise<number> {
    const stage = (await stagesOf(r)).get(FLOW_WORKER_SESSION_KIND)!
    const match = stage.bound!.match(/× (\d+) surface/)
    if (!match) throw new Error(`no surface count in the bound: ${stage.bound}`)
    return Number(match[1])
  }

  it('prices ONE surface for a repo whose manifests imply an api-only recipe', async () => {
    const r = repoWithPackage(
      { name: 'svc', dependencies: { express: '^4' }, scripts: { start: 'node server.js' } },
      { 'server.js': '// stub\n' },
    )

    expect(await pricedSurfaces(r)).toBe(1)
  })

  it('prices ONE surface for a repo whose manifests imply a cli-only recipe', async () => {
    const r = repoWithPackage({ name: 'tool', bin: 'cli.js' }, { 'cli.js': '// stub\n' })

    expect(await pricedSurfaces(r)).toBe(1)
  })

  it('prices EVERY runnable surface when the proposer cannot decide', async () => {
    const r = repoWithPackage({ name: 'svc', dependencies: { express: '^4' } })

    expect(await pricedSurfaces(r)).toBe(runnableDriverIds.length)
  })
})
