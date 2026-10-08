/**
 * What the one-shot RETIREMENT left behind, pinned on the things a refactor
 * could quietly break:
 *
 *  - the four session seams are REQUIRED options — a caller that forgets one
 *    must not compile, because there is no production fallback any more;
 *  - a flow settles by its named inputs, compared name by name;
 *  - an abort still reports EVERY stage's losses: the transport tally of the
 *    surviving one-shots AND the session-kind tallies, which the transport audit
 *    never sees.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { readManifest, loadScenarios } from '@truecourse/guard-runner'
import {
  generateGuards,
  flowGenerationInputComponents,
  flowSettleVerdict,
  type FlowGenerationInputParts,
  MATCH_SESSION_KIND,
  type GenerateGuardsOptions,
} from '@truecourse/guard-generator'
import { movedNamedInputs, movedSchemeInputs } from '@truecourse/shared'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  runGenerate,
  flowStageSeams,
  claimsBy,
  flowsAreaSessionOf,
  submitWorkerSessions,
  sessionSummary,
  FLOWS_KIND,
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

function seed(): string {
  const r = repo()
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, DOC_CONTENT)
  return r
}

describe('flowGenerationInputComponents — the hash, by name', () => {
  const parts: FlowGenerationInputParts = {
    flowFingerprint: 'f',
    assignmentFingerprints: ['a'],
    interfaceFingerprints: ['i1', 'i2'],
    webCatalogReads: ['web/home:abc'],
    hasScenario: false,
    recipeSlice: 'rs',
    roster: 'ro',
    preparation: 'pr',
  }

  it('moves exactly the named component when one input moves', () => {
    const base = flowGenerationInputComponents(parts)
    const moved = (over: Partial<FlowGenerationInputParts>): string[] =>
      movedNamedInputs(base, flowGenerationInputComponents({ ...parts, ...over }))!
    expect(moved({})).toEqual([])
    expect(moved({ flowFingerprint: 'f2' })).toEqual(['flow'])
    expect(moved({ assignmentFingerprints: ['a2'] })).toEqual(['assignment'])
    expect(moved({ interfaceFingerprints: ['i1'] })).toEqual(['interfaces'])
    // The web catalog enters by what the flow's session read.
    expect(moved({ webCatalogReads: ['web/home:moved'] })).toEqual(['webCatalog.reads'])
    expect(moved({ recipeSlice: 'rs2' })).toEqual(['recipe.slice'])
    expect(moved({ roster: 'ro2' })).toEqual(['roster'])
    expect(moved({ preparation: 'pr2' })).toEqual(['preparation.run'])
  })

  it('leaves the interface catalog out of a flow that holds a scenario', () => {
    const withScenario = { ...parts, hasScenario: true }
    const base = flowGenerationInputComponents(withScenario)
    expect(Object.keys(base)).not.toEqual(expect.arrayContaining(['assignment']))
    expect(Object.keys(base)).not.toEqual(expect.arrayContaining(['interfaces']))
    expect(Object.keys(base)).not.toEqual(expect.arrayContaining(['webCatalog.reads']))
    // An amended, retired or swapped task moves nothing it is compared on.
    expect(movedNamedInputs(base, flowGenerationInputComponents({
      ...withScenario,
      assignmentFingerprints: ['a2'],
      interfaceFingerprints: ['i1'],
      webCatalogReads: ['web/home:absent'],
    }))).toEqual([])
    // A row stored under the old rule still carries them, and settles.
    const stored = flowGenerationInputComponents(parts)
    expect(movedSchemeInputs(stored, base)).toEqual([])
  })
})

describe('flowSettleVerdict — the compare rules', () => {
  const components = flowGenerationInputComponents({
    flowFingerprint: 'f',
    assignmentFingerprints: ['a'],
    interfaceFingerprints: ['i'],
    hasScenario: false,
    recipeSlice: 'rs',
    roster: 'ro',
    preparation: 'pr',
  })
  const settledHash = 'sha256:' + 'a'.repeat(64)

  it('settles a row whose stored names all still match, ignoring the ones it retired', () => {
    // A row from the old scheme: it carries `sections`, `prompts`, `recipe.*`
    // and the state-folding `prerequisites`, none of which exist any more, and
    // lacks the ones the scheme gained.
    const stored = { flow: components.flow, sections: 'ffffffffffffffff', prompts: 'deadbeefdeadbeef', 'recipe.manifests': 'cafecafecafecafe', prerequisites: 'f00df00df00df00d' }
    expect(flowSettleVerdict({ prior: { generationInputsHash: settledHash, generationInputs: stored }, components }))
      .toEqual({ settled: true, moved: [] })
  })

  it('re-opens on a name both records carry that differs, and names it', () => {
    const stored = { ...components, roster: 'ffffffffffffffff' }
    expect(flowSettleVerdict({ prior: { generationInputsHash: settledHash, generationInputs: stored }, components }))
      .toEqual({ settled: false, moved: ['roster'] })
  })

  it('does not settle a row with a hash and no names, and names nothing', () => {
    expect(flowSettleVerdict({ prior: { generationInputsHash: settledHash }, components }))
      .toEqual({ settled: false, moved: null })
  })

  it('never settles a flow nothing has authored', () => {
    expect(flowSettleVerdict({ prior: undefined, components })).toEqual({ settled: false, moved: null })
    expect(flowSettleVerdict({ prior: { generationInputsHash: null }, components }))
      .toEqual({ settled: false, moved: null })
  })
})

// ---------------------------------------------------------------------------
// The seams are required — the compile-time half of the retirement.
// ---------------------------------------------------------------------------

describe('generateGuards — the four session seams are required options', () => {
  it('does not compile without the flow-worker seam', () => {
    const r = seed()
    const seams = flowStageSeams(r)
    const missingWorker = {
      repoRoot: r,
      interfaces: seams.interfaces,
      matchRunner: seams.matchRunner,
      extractSession: seams.extractSession,
      flowsAreaSession: seams.flowsAreaSession,
      flowsEpicSession: seams.flowsEpicSession,
    }
    // @ts-expect-error — `flowWorkerSession` is REQUIRED since the one-shot
    // retirement; there is no production fallback to silently pick up.
    const options: GenerateGuardsOptions = missingWorker
    // The full set, in contrast, is assignable — the positive control.
    const complete: GenerateGuardsOptions = { ...missingWorker, flowWorkerSession: seams.flowWorkerSession }
    expect(Object.keys(options).length).toBeLessThan(Object.keys(complete).length)
  })
})

// ---------------------------------------------------------------------------
// The stub-seam pipeline end to end.
// ---------------------------------------------------------------------------

describe('generateGuards — the retired pipeline runs end to end on seams alone', () => {
  it('writes one scenario, settles the flow, and carries no triage anywhere', async () => {
    const r = seed()

    const result = await runGenerate({
      repoRoot: r,
      ...flowStageSeams(r),
      claims: claimsBy({ background: { untestable: 'design history' } }),
      flowWorkerSession: submitWorkerSessions(() => raw('relkit --version exits 0', PASSING_STEPS)),
    })

    expect(result.status).toBe('ok')
    expect(result.written).toMatchObject([{ flowId: 'version', status: 'passing' }])
    expect(loadScenarios(r).scenarios).toHaveLength(1)

    const entry = readManifest(r)!.flows.find((f) => f.flowId === 'version')!
    expect(entry.generationInputsHash).not.toBeNull()
    // Adjudication is the worker's own confirmed prediction now — the triage
    // stage is gone, so no scenario row may carry a verdict from it.
    expect(entry.scenarios[0].diagnosis?.triage).toBeUndefined()
    expect(result.unadjudicated ?? []).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Abort accounting across the two halves.
// ---------------------------------------------------------------------------

describe('generateGuards — a match wipeout reports the SESSION tallies too', () => {
  it('carries the guard.match transport tally beside every session kind’s losses', async () => {
    const r = seed()
    const seams = flowStageSeams(r)

    // One of two areas lost (non-systemic, so synthesis fails open); matching
    // then loses every SESSION, which is what puts its kind in the run's
    // tallies beside the pooled kind's.
    const result = await generateGuards({
      repoRoot: r,
      interfaces: seams.interfaces,
      flowsEpicSession: seams.flowsEpicSession,
      flowWorkerSession: seams.flowWorkerSession,
      recipeRunner: seams.recipeRunner,
      worldClassifyRunner: seams.worldClassifyRunner,
      matchRunner: async () => {
        throw new Error('the match session died')
      },
      leafSummaries: () => [
        sessionSummary(MATCH_SESSION_KIND, { ran: 1, failed: 1, firstError: 'the match session died' }),
      ],
      flowsAreaSession: async (input) => {
        const inner = await seams.flowsAreaSession(input)
        return {
          byArea: inner.byArea,
          summary: sessionSummary(FLOWS_KIND, { ran: 2, failed: 1, firstError: 'transport died' }),
        }
      },
    })

    expect(result.status).toBe('llm-failed')
    expect(result.reason).toContain(MATCH_SESSION_KIND)
    const byStage = new Map((result.llmFailures ?? []).map((f) => [f.stage, f]))
    // Every kind's losses ride the abort: the leaf that died and the pooled
    // kind beside it.
    expect(byStage.get(MATCH_SESSION_KIND)).toMatchObject({ attempts: 1, failures: 1 })
    expect(byStage.get(FLOWS_KIND)).toMatchObject({ attempts: 2, failures: 1 })
    // Nothing was written.
    expect(fs.existsSync(path.join(r, '.truecourse', 'scenarios', 'manifest.json'))).toBe(false)
  })

})
