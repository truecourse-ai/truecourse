import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runnableDriverIds } from '@truecourse/shared'
import { estimateGuardTokens } from '../../packages/core/src/services/llm/spec-estimate.js'
import {
  generateGuards,
  planGuardWork,
  collectWorkDocs,
  extractDocClaims,
  readCorpusAreaTags,
  buildFlowAreas,
  planFlowSynthesis,
  synthesizeFlows,
  flowSectionKey,
  type FlowAreaDocInput,
  type FlowsRunner,
} from '@truecourse/guard-generator'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  extractBy,
  authorBy,
  runGenerate,
  flowPerClaim,
  matchAll,
  faithfulReviewer,
  cliJourney,
  writeJourneySnapshot,
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

/** An api recipe (optionally with a seed) — the seed stage's recipe-side gate. */
function writeApiRecipeJson(r: string, seed?: unknown): void {
  const target = path.join(r, '.truecourse', 'scenarios', 'recipe.json')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(
    target,
    JSON.stringify({ build: 'true', api: { serve: ['node', 'server.js'], ...(seed ? { seed } : {}) } }, null, 2),
  )
}

/** The last generate's report, carrying ONE blocked-on gap with `reason`. */
function writeBlockedReport(r: string, reason: string): void {
  const target = path.join(r, '.truecourse', 'guard', 'result.json')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(
    target,
    JSON.stringify({
      generatedAt: '2026-07-29T00:00:00.000Z',
      status: 'ok',
      sectionsTotal: 1,
      sectionsChanged: 0,
      skippedUnchanged: 1,
      noChanges: false,
      written: [],
      coverageGaps: [{ doc: DOC, anchor: 'version', kind: 'blocked-on', flowId: 'version', reason }],
      birthFindings: [],
      errors: [],
      extractionFailures: [],
      orphaned: [],
    }),
  )
}

const extract = extractBy({ background: { untestable: 'bg' } })
const author = authorBy({ version: raw('v', PASSING_STEPS) })

describe('estimateGuardTokens', () => {
  it('cold: one extract call for the single work doc, recipe present ⇒ no discovery call', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const est = await estimateGuardTokens(r)
    expect(est.subjectLabel).toBe('2 sections')
    const extractStage = est.stages!.find((s) => s.stage === 'guardExtract')!
    expect(extractStage.calls).toBe(1) // one doc, one view (under budget)
    expect(est.stages!.find((s) => s.stage === 'guardRecipe')).toBeUndefined() // 0 calls dropped
    expect(est.stages!.find((s) => s.stage === 'guardAuthor')).toBeTruthy()
    expect(est.totalEstimatedTokens).toBeGreaterThan(0)
  })

  it('adds a recipe-discovery call when no recipe.json exists', async () => {
    const r = repo()
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const est = await estimateGuardTokens(r)
    expect(est.stages!.find((s) => s.stage === 'guardRecipe')!.calls).toBe(1)
  })

  it('prices the seed draft only when the LAST generate left a missing-data gap', async () => {
    const r = repo()
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)
    // An api recipe with no seed — the drafting stage's other two conditions.
    writeApiRecipeJson(r)

    // No generate report at all ⇒ no gaps known ⇒ the stage is not priced.
    expect((await estimateGuardTokens(r)).stages!.find((s) => s.stage === 'guardSeed')).toBeUndefined()

    // A gap on something else is still not a seed's business.
    writeBlockedReport(r, 'blocked on stripe: charge a card')
    expect((await estimateGuardTokens(r)).stages!.find((s) => s.stage === 'guardSeed')).toBeUndefined()

    // The missing-data noun prices exactly ONE call.
    writeBlockedReport(r, 'blocked on missing-data, an org: list an org')
    const priced = (await estimateGuardTokens(r)).stages!.find((s) => s.stage === 'guardSeed')!
    expect(priced.calls).toBe(1)
    expect(priced.label).toBe('Drafting seed script')

    // …and a recipe that ALREADY has a seed prices none: the stage never overwrites.
    writeApiRecipeJson(r, { command: 'node mine.mjs', provides: { fixtures: { org: ['id'] } } })
    expect((await estimateGuardTokens(r)).stages!.find((s) => s.stage === 'guardSeed')).toBeUndefined()
  })

  it('cache-aware: after a full generate nothing is left to do ⇒ empty estimate', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const first = await runGenerate({ repoRoot: r, extractRunner: extract, generateRunner: author })
    expect(first.written).toHaveLength(1)

    // Every stage is a cache hit and every flow's inputs hash still matches the
    // manifest, so the estimate has NO stages — the confirm prompt is skipped and
    // the run is a deterministic no-op. (`background` states no claim, so no flow
    // binds it: it counts as an unguarded section forever, which is honest.)
    const est = await estimateGuardTokens(r)
    expect(est.stages).toEqual([])
    expect(est.totalEstimatedTokens).toBe(0)
    expect(est.subjectLabel).toBe('1 of 2 sections changed')

    const second = await runGenerate({ repoRoot: r, extractRunner: extract, generateRunner: author })
    expect(second.noChanges).toBe(true)
    expect(second.written).toEqual([])
  })

  it('a moved journey re-matches and re-authors the flow that grounds on it', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    await runGenerate({ repoRoot: r, extractRunner: extract, generateRunner: author })
    expect((await estimateGuardTokens(r)).stages).toEqual([])

    // The cli surface MOVED (the command gained a flag). The catalog fingerprint
    // changes ⇒ the match cache misses ⇒ the estimate plans a matching call, and the
    // flow it grounds re-authors (its inputs hash folds the journey fingerprint).
    writeJourneySnapshot(r, [cliJourney(['relkit'], ['--json']), cliJourney(['relkit', 'boom'])])
    const est = await estimateGuardTokens(r)
    const stages = new Map(est.stages!.map((s) => [s.stage, s]))
    expect(stages.get('guardMatch')!.calls).toBe(1)
    expect(stages.get('guardAuthor')!.calls).toBe(1)
    // Nothing spec-side moved, so extraction and synthesis stay silent.
    expect(stages.has('guardExtract')).toBe(false)
    expect(stages.has('guardFlows')).toBe(false)
  })
})

describe('estimateGuardTokens — estimate/runtime symmetry', () => {
  it('every stage the run calls was quoted by the estimate first', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    // The estimate BEFORE the run: whatever it quotes is what may be spent.
    const quoted = new Set(((await estimateGuardTokens(r)).stages ?? []).map((s) => s.stage))

    // The run, counting an actual call per stage.
    const called = new Set<string>()
    await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({ background: { untestable: 'bg' } }, () => called.add('guardExtract')),
      flowsRunner: flowPerClaim(() => called.add('guardFlows')),
      matchRunner: matchAll(() => called.add('guardMatch')),
      generateRunner: authorBy({ version: raw('v', PASSING_STEPS) }, () => called.add('guardAuthor')),
      fidelityRunner: faithfulReviewer(() => called.add('guardFidelity')),
    })

    expect(called.size).toBeGreaterThan(0)
    for (const stage of called) expect(quoted.has(stage)).toBe(true)
  })

  it('a cold repo quotes matching and authoring against the claim-derived flow bound', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const stages = new Map(((await estimateGuardTokens(r)).stages ?? []).map((s) => [s.stage, s]))
    const match = stages.get('guardMatch')!
    const author = stages.get('guardAuthor')!
    expect(match.model).toBe('sonnet')
    expect(author.model).toBe('opus')
    // The flow count is a synthesis OUTPUT — both stages say so instead of guessing.
    expect(match.bound).toContain('flows ≤ runnable claims')
    expect(author.bound).toContain('flows ≤ runnable claims')
    // The evidence retry is at most one re-author per authored scenario.
    expect(stages.get('guardRetry')!.callsRange).toEqual({ low: 0, high: author.callsRange!.high })
  })
})

// --- guard.flows (flow synthesis) -------------------------------------------

const AUTH_DOC = 'docs/auth.md'
const AUTH_CONTENT = ['## signin', '`relkit login` stores the token and exits 0.'].join('\n')

/** One flow per claim — the honest floor, so the honesty rule always settles. */
const flowsForEveryClaim: FlowsRunner = async (ctx) => ({
  flows: ctx.claims.map((c, i) => ({
    title: `${ctx.areaId} flow ${i + 1}`,
    goal: `a user gets what "${c.claim}" promises`,
    milestones: [{ doc: c.doc, anchor: c.anchor, claimTitle: c.claim, order: 1 }],
  })),
  noFlowClaims: [],
})

/** Warm the extract cache (without settling the manifest) and build the areas the
 *  estimate reconstructs, so a test can compare estimate against run. */
async function warmExtractionAreas(r: string) {
  const plan = planGuardWork(r)
  const areaTags = readCorpusAreaTags(r)
  const inputs: FlowAreaDocInput[] = []
  for (const doc of collectWorkDocs(r, plan)) {
    const res = await extractDocClaims(r, doc, extract)
    if (!res.ok) throw new Error('fixture extraction failed')
    inputs.push({
      doc: doc.doc,
      areaTags: areaTags.get(doc.doc) ?? [],
      outline: doc.sections.map((s) => ({ anchor: s.anchor, headingText: s.headingText, level: s.level })),
      untestable: res.data.untestable.map((u) => ({ anchor: u.sectionAnchor, reason: u.reason })),
      claims: res.data.claims.map((c) => ({ doc: doc.doc, anchor: c.sectionAnchor, title: c.claim, driver: c.driver })),
    })
  }
  return {
    areas: buildFlowAreas(inputs),
    sectionFingerprints: new Map(plan.sections.map((s) => [flowSectionKey(s.doc, s.anchor), s.fingerprint])),
  }
}

describe('estimateGuardTokens — flow synthesis stage', () => {
  it('cold: one call per area with a changed section, plus the epic ceiling', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [
      { ref: DOC, areaTags: ['cli'] },
      { ref: AUTH_DOC, areaTags: ['auth'] },
    ])
    writeDoc(r, DOC, DOC_CONTENT)
    writeDoc(r, AUTH_DOC, AUTH_CONTENT)

    const stage = (await estimateGuardTokens(r)).stages!.find((s) => s.stage === 'guardFlows')!
    expect(stage.label).toBe('Synthesizing flows')
    expect(stage.model).toBe('sonnet')
    expect(stage.calls).toBe(3) // two areas + one epic pass
    expect(stage.callsRange).toEqual({ low: 2, high: 3 })
    // The flow COUNT is a synthesis output, so the estimate quotes its bound.
    expect(stage.bound).toContain('flows ≤ runnable claims')
  })

  it('a single-area repo needs no epic pass', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const stage = (await estimateGuardTokens(r)).stages!.find((s) => s.stage === 'guardFlows')!
    expect(stage.calls).toBe(1)
  })

  it('warm extract cache: the estimate probes the real flows cache and agrees with the run', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const { areas, sectionFingerprints } = await warmExtractionAreas(r)
    const planned = await planFlowSynthesis(r, areas)

    // Exact: the claim inventory is known offline, so the bound carries its count.
    const before = (await estimateGuardTokens(r)).stages!.find((s) => s.stage === 'guardFlows')!
    expect(before.calls).toBe(planned.areaCalls + planned.epicCalls)
    expect(before.bound).toContain(`(${planned.maxFlows} today)`)

    // Estimate plans a call ⇔ the run makes one.
    const run = await synthesizeFlows({ repoRoot: r, areas, runner: flowsForEveryClaim, sectionFingerprints })
    expect(run.calls).toBe(before.calls)
    expect(run.unsettled).toEqual([])

    // Synthesized ⇒ the stage is gone, and a re-run would indeed call nothing.
    const after = await estimateGuardTokens(r)
    expect(after.stages!.find((s) => s.stage === 'guardFlows')).toBeUndefined()
    const rerun = await synthesizeFlows({
      repoRoot: r,
      areas,
      runner: async () => {
        throw new Error('the cache should have answered')
      },
      sectionFingerprints,
    })
    expect(rerun.calls).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// The surfaces a MISSING recipe is priced on (item 55, Phase 1c). Discovery is
// about to run, so the estimate asks the SAME deterministic proposer it will —
// pure over the working tree, so it costs the estimate nothing — instead of
// assuming a cli entry, which mispriced every api-only repo.
// ---------------------------------------------------------------------------

describe('estimateGuardTokens — the surfaces a missing recipe is priced on', () => {
  /** A recipe-less repo whose package.json is written by the caller. */
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
    const author = (await estimateGuardTokens(r)).stages!.find((s) => s.stage === 'guardAuthor')!
    const match = author.bound!.match(/× (\d+) surface/)
    if (!match) throw new Error(`no surface count in the bound: ${author.bound}`)
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
    // No scripts, no bin: the deterministic path refuses, the model could propose
    // either surface, and the estimate is a ceiling — so it quotes both.
    const r = repoWithPackage({ name: 'svc', dependencies: { express: '^4' } })

    expect(await pricedSurfaces(r)).toBe(runnableDriverIds.length)
  })
})
