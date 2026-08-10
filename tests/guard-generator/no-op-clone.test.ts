/**
 * THE CLONE NO-OP — `guard generate` over a fully generated repo whose gitignored
 * `.truecourse/.cache/` is gone (exactly what a teammate's fresh clone has).
 *
 * The committed records (corpus, docs, `scenarios/flows.json`,
 * `scenarios/manifest.json` with its flow bindings + `gapSections`) already say
 * nothing moved, so the run must do NOTHING: no extraction, no synthesis, no
 * matching, no authoring — and the pre-flight estimate must quote no stages at
 * all, so the confirm prompt is skipped for a run that cannot cost a cent.
 *
 * Before the committed-state gate, such a clone re-ran claim EXTRACTION over the
 * whole doc universe (and synthesis behind it) purely to re-derive change
 * detection the manifest had already settled — real money, and a hard abort when
 * the model was unreachable.
 *
 * The guards matter as much as the fix: a changed section, a moved recipe, or a
 * journey whose code moved must still re-run, cold caches or not.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { dismissGuardClaim, loadScenarios } from '@truecourse/guard-runner'
import { readFlowsFile } from '@truecourse/guard-generator'
import { estimateGuardTokens } from '../../packages/core/src/services/llm/spec-estimate.js'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  extractBy,
  authorBy,
  flowPerClaim,
  matchAll,
  noEpics,
  journeysOf,
  cliJourney,
  DEFAULT_JOURNEYS,
  runGenerate,
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

const extract = extractBy({ background: { untestable: 'design history only' } })
const author = authorBy({ version: raw('v', PASSING_STEPS) })

/** Delete the derived KV caches — what a fresh clone of the repo actually has. */
function deleteCaches(r: string): void {
  fs.rmSync(path.join(r, '.truecourse', '.cache'), { recursive: true, force: true })
}

function manifestBytes(r: string): string {
  return fs.readFileSync(path.join(r, '.truecourse', 'scenarios', 'manifest.json'), 'utf-8')
}

/** Write `decisions.json` with the given flow ids dismissed (the user's curation). */
function writeDismissedFlows(r: string, flowIds: string[]): void {
  const target = path.join(r, '.truecourse', 'scenarios', 'decisions.json')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(
    target,
    JSON.stringify({
      version: 1,
      dismissedClaims: [],
      dismissedFlows: flowIds.map((flowId) => ({
        flowId,
        title: flowId,
        dismissedAt: '2026-08-10T00:00:00.000Z',
        note: 'not a user path',
      })),
    }),
  )
}

function seedRepo(): string {
  const r = repo()
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, DOC_CONTENT)
  return r
}

/** Every LLM seam, wired to explode — a run that reaches any stage fails loudly. */
function noRunners() {
  return {
    extractRunner: async () => {
      throw new Error('extraction must not run')
    },
    flowsRunner: async () => {
      throw new Error('flow synthesis must not run')
    },
    flowsEpicRunner: async () => {
      throw new Error('the epic pass must not run')
    },
    matchRunner: async () => {
      throw new Error('matching must not run')
    },
    generateRunner: async () => {
      throw new Error('authoring must not run')
    },
    fidelityRunner: async () => {
      throw new Error('fidelity review must not run')
    },
    triageRunner: async () => {
      throw new Error('triage must not run')
    },
  }
}

describe('guard generate — the committed-state no-op on a cold-cache clone', () => {
  it('makes not one LLM call when every derived cache is gone', async () => {
    const r = seedRepo()
    const first = await runGenerate({ repoRoot: r, extractRunner: extract, generateRunner: author })
    expect(first.written).toHaveLength(1)

    // The warm no-op, for the behaviour the cold one must match.
    const warm = await runGenerate({ repoRoot: r, extractRunner: extract, generateRunner: author })
    expect(warm.noChanges).toBe(true)
    const warmManifest = manifestBytes(r)

    // THE CLONE: every gitignored cache gone, nothing else touched.
    deleteCaches(r)

    const cold = await runGenerate({ repoRoot: r, ...noRunners() })
    expect(cold.status).toBe('ok')
    expect(cold.noChanges).toBe(true)
    expect(cold.written).toEqual([])
    expect(cold.errors).toEqual([])
    expect(cold.llmFailures).toEqual([])
    // The same accounting the warm no-op reports.
    expect(cold.sectionsTotal).toBe(warm.sectionsTotal)
    expect(cold.sectionsChanged).toBe(0)
    expect(cold.skippedUnchanged).toBe(warm.skippedUnchanged)
    expect(cold.flows).toMatchObject({ total: 1, skipped: 1, settled: 1, unsettled: 0 })
    expect(cold.journeys).toEqual(warm.journeys)
    // ...and the committed corpus is untouched, byte for byte.
    expect(manifestBytes(r)).toBe(warmManifest)
    expect(loadScenarios(r).scenarios.map((s) => s.id)).toEqual(['version.cli.1'])
  })

  it('the pre-flight estimate quotes nothing for that same state', async () => {
    const r = seedRepo()
    await runGenerate({ repoRoot: r, extractRunner: extract, generateRunner: author })
    deleteCaches(r)

    // No stages ⇒ no cost, and the CLI/dashboard skip the confirm prompt.
    const est = await estimateGuardTokens(r)
    expect(est.stages).toEqual([])
    expect(est.totalEstimatedTokens).toBe(0)
    expect(est.estimatedCostUsd).toBeUndefined()
    expect(est.subjectLabel).toBe('all 2 sections cached')
  })

  it('derives the journeys when the snapshot is gone too — the REAL clone', async () => {
    const r = seedRepo()
    await runGenerate({ repoRoot: r, extractRunner: extract, generateRunner: author })

    // A true clone has neither: `.cache/` AND `guard/journeys.json` are both in
    // `.truecourse/.gitignore`, so neither ever travels. The journey fingerprints
    // the no-op gate needs are CODE-derived, so the estimate maps them the same
    // deterministic (LLM-free) way generate does moments later, rather than
    // declining and quoting the whole extraction bill for a run that makes no call.
    deleteCaches(r)
    fs.rmSync(path.join(r, '.truecourse', 'guard', 'journeys.json'))

    const est = await estimateGuardTokens(r, undefined, { journeys: DEFAULT_JOURNEYS(r) })
    expect(est.stages).toEqual([])
    expect(est.totalEstimatedTokens).toBe(0)
    expect(est.subjectLabel).toBe('all 2 sections cached')

    // ...and the derivation buys no false silence: a real change still quotes,
    // snapshot or no snapshot.
    fs.rmSync(path.join(r, '.truecourse', 'guard', 'journeys.json'))
    writeDoc(r, DOC, DOC_CONTENT.replace('exits 0', 'exits 0 quietly'))
    const changed = await estimateGuardTokens(r, undefined, { journeys: DEFAULT_JOURNEYS(r) })
    expect(changed.stages!.length).toBeGreaterThan(0)
  })

  it('a carried ORPHAN entry never re-opens the whole pipeline', async () => {
    const r = seedRepo()
    await runGenerate({ repoRoot: r, extractRunner: extract, generateRunner: author })

    // The documented command is dropped from the spec. Its flow leaves synthesis,
    // but its committed scenario is real coverage: the entry is carried forward and
    // MARKED orphaned, dead bindings and all — permanently, since nothing re-derives
    // it. Those bindings make `planGuardWork` report an orphaned section on EVERY
    // later run, which must not drag extraction back in.
    writeDoc(r, DOC, '## background\nDesign history; nothing externally observable here.\n')
    const second = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({ background: { untestable: 'design history only' } }),
      generateRunner: author,
    })
    expect(second.orphaned).toHaveLength(1)

    deleteCaches(r)
    fs.rmSync(path.join(r, '.truecourse', 'guard', 'journeys.json'))
    expect((await estimateGuardTokens(r, undefined, { journeys: DEFAULT_JOURNEYS(r) })).stages).toEqual([])

    const third = await runGenerate({ repoRoot: r, ...noRunners() })
    expect(third.noChanges).toBe(true)
    // Reporting the orphan is not work — the no-op says exactly what a full run says.
    expect(third.orphaned).toEqual(second.orphaned)
    expect(loadScenarios(r).scenarios.map((s) => s.id)).toEqual(['version.cli.1'])
  })

  it('still re-runs when a section changed, cold caches or not', async () => {
    const r = seedRepo()
    await runGenerate({ repoRoot: r, extractRunner: extract, generateRunner: author })
    deleteCaches(r)
    writeDoc(r, DOC, DOC_CONTENT.replace('exits 0', 'exits 0 and prints nothing else'))

    // The estimate declines the no-op too — it prices the extraction the run pays for.
    const est = await estimateGuardTokens(r)
    expect(est.stages!.length).toBeGreaterThan(0)

    let extractCalls = 0
    let authorCalls = 0
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({ background: { untestable: 'design history only' } }, () => extractCalls++),
      generateRunner: authorBy({ version: raw('v', PASSING_STEPS) }, () => authorCalls++),
    })
    expect(res.sectionsChanged).toBe(1)
    expect(res.noChanges).toBe(false)
    expect(extractCalls).toBeGreaterThan(0)
    expect(authorCalls).toBeGreaterThan(0)

    expect(res.skippedUnchanged).toBe(1)
  })

  it('still re-authors when the recipe moved, cold caches or not', async () => {
    const r = seedRepo()
    await runGenerate({ repoRoot: r, extractRunner: extract, generateRunner: author })
    deleteCaches(r)
    // A recipe edit moves the recipe fingerprint, which every flow's inputs hash
    // folds — so every flow is work again even though no section moved.
    writeRecipe(r, { build: 'echo rebuilt' })
    expect((await estimateGuardTokens(r)).stages!.length).toBeGreaterThan(0)

    let authorCalls = 0
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extract,
      generateRunner: authorBy({ version: raw('v', PASSING_STEPS) }, () => authorCalls++),
    })
    expect(res.sectionsChanged).toBe(0)
    expect(res.noChanges).toBe(false)
    expect(authorCalls).toBe(1)
  })

  /**
   * APPLIED vs PENDING curation. A `dismissedFlows` entry never removes the flow
   * from `scenarios/flows.json` — synthesis keeps producing it, and the run drops
   * it every time on the way past. What the run actually DOES about a dismissal is
   * delete the flow's manifest entry and its scenario files; once that has
   * happened the dismissal is APPLIED and every later run is a pure no-op ("No
   * tests written", nothing rewritten). So "is a dismissed flow still in the
   * corpus?" is the wrong question — it is true forever, and asking it meant a
   * corpus with any dismissal at all could never quote an empty estimate.
   */
  it('a dismissal that is already APPLIED is settled — not work forever', async () => {
    const r = seedRepo()
    await runGenerate({ repoRoot: r, extractRunner: extract, generateRunner: author })
    expect(loadScenarios(r).scenarios.map((s) => s.id)).toEqual(['version.cli.1'])

    // The user dismisses the only flow; this run APPLIES it — the entry goes, the
    // scenario file goes. That run is real work.
    writeDismissedFlows(r, ['version'])
    const applying = await runGenerate({ repoRoot: r, extractRunner: extract, generateRunner: author })
    expect(applying.noChanges).toBe(false)
    expect(loadScenarios(r).scenarios).toEqual([])
    // The flow is STILL in the committed corpus — synthesis keeps producing it.
    expect(readFlowsFile(r)!.flows.map((f) => f.id)).toEqual(['version'])

    // From here the corpus is settled. A clone (no caches, no journey snapshot)
    // must quote nothing and run without a single call.
    deleteCaches(r)
    fs.rmSync(path.join(r, '.truecourse', 'guard', 'journeys.json'), { force: true })
    const est = await estimateGuardTokens(r, undefined, { journeys: DEFAULT_JOURNEYS(r) })
    expect(est.stages).toEqual([])
    expect(est.totalEstimatedTokens).toBe(0)

    const cold = await runGenerate({ repoRoot: r, ...noRunners() })
    expect(cold.noChanges).toBe(true)
    expect(cold.written).toEqual([])
    expect(loadScenarios(r).scenarios).toEqual([])
  })

  it('a FRESH dismissal is still work — its scenarios are there to prune', async () => {
    const r = seedRepo()
    await runGenerate({ repoRoot: r, extractRunner: extract, generateRunner: author })
    deleteCaches(r)

    // Dismissed but never applied: the manifest entry and the scenario file are
    // both still on disk, and the run would delete them.
    writeDismissedFlows(r, ['version'])
    expect((await estimateGuardTokens(r)).stages!.length).toBeGreaterThan(0)

    const res = await runGenerate({ repoRoot: r, extractRunner: extract, generateRunner: author })
    expect(res.noChanges).toBe(false)
    expect(res.flows.dismissed).toBe(1)
    expect(loadScenarios(r).scenarios).toEqual([])
  })

  it('an APPLIED claim dismissal is settled too', async () => {
    const r = seedRepo()
    await runGenerate({ repoRoot: r, extractRunner: extract, generateRunner: author })
    dismissGuardClaim(r, {
      doc: DOC,
      anchor: 'version',
      title: 'version claim',
      dismissedAt: '2026-08-10T00:00:00.000Z',
    })
    // The run that applies it re-synthesizes: the milestone is gone, so the flow
    // leaves `flows.json` and its scenario is pruned with it.
    const applying = await runGenerate({ repoRoot: r, extractRunner: extract, generateRunner: author })
    expect(applying.noChanges).toBe(false)
    expect(readFlowsFile(r)!.flows).toEqual([])

    deleteCaches(r)
    expect((await estimateGuardTokens(r)).stages).toEqual([])
    const cold = await runGenerate({ repoRoot: r, ...noRunners() })
    expect(cold.noChanges).toBe(true)
  })

  it('still re-runs when a claim a live flow is composed from was dismissed', async () => {
    const r = seedRepo()
    await runGenerate({ repoRoot: r, extractRunner: extract, generateRunner: author })
    deleteCaches(r)
    // Curation rides no fingerprint: dismissing a claim removes a milestone, so the
    // flow re-synthesizes. A gate that skipped on hashes alone would swallow it.
    dismissGuardClaim(r, {
      doc: DOC,
      anchor: 'version',
      title: 'version claim',
      dismissedAt: '2026-08-10T00:00:00.000Z',
    })
    expect((await estimateGuardTokens(r)).stages!.length).toBeGreaterThan(0)

    let extractCalls = 0
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({ background: { untestable: 'design history only' } }, () => extractCalls++),
      generateRunner: author,
    })
    expect(extractCalls).toBeGreaterThan(0)
    expect(res.coverageGaps.some((g) => g.kind === 'dismissed')).toBe(true)
  })

  it('still re-authors when the journey its plan walks moved under it', async () => {
    const r = seedRepo()
    await runGenerate({ repoRoot: r, extractRunner: extract, generateRunner: author })
    deleteCaches(r)

    let authorCalls = 0
    const res = await runGenerate({
      repoRoot: r,
      // The mapper now reports a DIFFERENT journey shape for the same command —
      // the code under the flow moved, so its inputs hash moves with it.
      journeys: journeysOf(r, cliJourney(['relkit'], ['--json']), cliJourney(['relkit', 'boom'])),
      extractRunner: extract,
      flowsRunner: flowPerClaim(),
      flowsEpicRunner: noEpics,
      matchRunner: matchAll(),
      generateRunner: authorBy({ version: raw('v', PASSING_STEPS) }, () => authorCalls++),
    })
    expect(res.sectionsChanged).toBe(0)
    expect(res.noChanges).toBe(false)
    expect(authorCalls).toBe(1)
  })
})
