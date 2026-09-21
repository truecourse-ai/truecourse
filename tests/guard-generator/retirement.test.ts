/**
 * What the one-shot RETIREMENT left behind, pinned on the
 * three things a refactor could quietly break:
 *
 *  - the four session seams are REQUIRED options — a caller that forgets one
 *    must not compile, because there is no production fallback any more;
 *  - `legacyFlowGenerationInputsHash` FROZE the retired prompts' fingerprints as
 *    literal salt, so every user's committed flow hashes survived the cut-over.
 *    That value must never move again;
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
  legacyFlowGenerationInputsHash,
  flowGenerationInputComponents,
  flowInterfaceFingerprintBag,
  flowSettleVerdict,
  type FlowGenerationInputParts,
  type GenerateGuardsOptions,
} from '@truecourse/guard-generator'
import { movedNamedInputs } from '@truecourse/shared'
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
  extractSessionOf,
  flowsAreaSessionOf,
  submitWorkerSessions,
  sessionSummary,
  EXTRACT_KIND,
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

// ---------------------------------------------------------------------------
// The frozen hash.
// ---------------------------------------------------------------------------

describe('legacyFlowGenerationInputsHash — the frozen retirement salt', () => {
  /**
   * The value the PRE-retirement code produced for these inputs, recomputed off
   * git HEAD before the cut-over. `section-plan.ts` keeps the retired
   * extract/flows/epic prompt fingerprints as literal constants precisely so
   * this number could not move: swapping in the session prompts' fingerprints
   * would have re-authored every committed flow in every user's repo for no
   * behavioral reason. If this case ever goes red, the salt moved and every
   * committed corpus is about to be re-worked.
   *
   * MOVED ONCE, DELIBERATELY, with the blast-radius cut: the canonical cli/api
   * scenario schemas gained `world` and the author doctrine gained the
   * shared-world/self-mint contract, both of which the corpus is MEANT to
   * re-author under — the old corpora were written with no blast-radius
   * discipline at all (a committed delete-account scenario deleted the seeded
   * principal mid-run).
   */
  // Intentionally rolled for case-granular matching, reviewed preparation profiles,
  // prerequisite eligibility, grounded proof, and the explicit review-policy version.
  // Policy v5 deliberately revalidates committed coverage under typed web evidence.
  // Provider control changes the authoring contract and includes the web prompt
  // in this hash. The retired extract/flows/epic salts remain unchanged.
  const GOLDEN = 'sha256:eb1546f70ef7a02e259ba2d7a26c109ed2ded15caf0bd2b9c854fd48690fd89a'

  it('retains the retirement salt with the current matching doctrine', () => {
    expect(
      legacyFlowGenerationInputsHash({
        flowFingerprint: 'f',
        sectionKeys: ['s'],
        interfaceFingerprints: ['i'],
        recipeFingerprint: 'r',
      }),
    ).toBe(GOLDEN)
  })

  it('still moves with every input it is supposed to track', () => {
    const base = { flowFingerprint: 'f', sectionKeys: ['s'], interfaceFingerprints: ['i'], recipeFingerprint: 'r' }
    for (const moved of [
      { ...base, flowFingerprint: 'f2' },
      { ...base, sectionKeys: ['s2'] },
      { ...base, interfaceFingerprints: ['i2'] },
      { ...base, recipeFingerprint: 'r2' },
    ]) {
      expect(legacyFlowGenerationInputsHash(moved)).not.toBe(legacyFlowGenerationInputsHash(base))
    }
    // Order-insensitive on both sorted lists.
    expect(
      legacyFlowGenerationInputsHash({ ...base, sectionKeys: ['b', 'a'], interfaceFingerprints: ['y', 'x'] }),
    ).toBe(legacyFlowGenerationInputsHash({ ...base, sectionKeys: ['a', 'b'], interfaceFingerprints: ['x', 'y'] }))
  })
})

describe('flowGenerationInputComponents — the hash, by name', () => {
  const parts: FlowGenerationInputParts = {
    flowFingerprint: 'f',
    sectionKeys: ['s1', 's2'],
    assignmentFingerprints: ['a'],
    interfaceFingerprints: ['i1', 'i2'],
    webCatalogFingerprint: 'w',
    webCatalogReads: ['web/home:abc'],
    prerequisiteMaterial: 'p',
    prerequisiteShape: 'ps',
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
    expect(moved({ sectionKeys: ['s1', 's3'] })).toEqual(['sections'])
    expect(moved({ sectionKeys: ['s2', 's1'] })).toEqual([])
    expect(moved({ assignmentFingerprints: ['a2'] })).toEqual(['assignment'])
    expect(moved({ interfaceFingerprints: ['i1'] })).toEqual(['interfaces'])
    // The whole catalog rides the LEGACY bag alone; what the flow's session
    // read is the component.
    expect(moved({ webCatalogFingerprint: 'w2' })).toEqual([])
    expect(moved({ webCatalogReads: ['web/home:moved'] })).toEqual(['webCatalog.reads'])
    // The resolved STATE rides the legacy bag alone; the shape is the component.
    expect(moved({ prerequisiteMaterial: 'p2' })).toEqual([])
    expect(moved({ prerequisiteShape: 'ps2' })).toEqual(['prerequisites.shape'])
    expect(moved({ recipeSlice: 'rs2' })).toEqual(['recipe.slice'])
    expect(moved({ roster: 'ro2' })).toEqual(['roster'])
    expect(moved({ preparation: 'pr2' })).toEqual(['preparation'])
  })

  it('folds into the hash every member the bag always carried', () => {
    expect([...flowInterfaceFingerprintBag(parts)].sort()).toEqual(['a', 'i1', 'i2', 'p', 'w'])
    const { webCatalogFingerprint: _none, ...noWeb } = parts
    expect([...flowInterfaceFingerprintBag(noWeb)].sort()).toEqual(['a', 'i1', 'i2', 'p'])
  })
})

describe('flowSettleVerdict — the three compare rules and the one legacy check', () => {
  const components = flowGenerationInputComponents({
    flowFingerprint: 'f',
    sectionKeys: ['s1'],
    assignmentFingerprints: ['a'],
    interfaceFingerprints: ['i'],
    prerequisiteMaterial: 'p',
    prerequisiteShape: 'ps',
    recipeSlice: 'rs',
    roster: 'ro',
    preparation: 'pr',
  })
  const legacyHash = 'sha256:' + 'a'.repeat(64)

  it('settles a row whose stored names all still match, ignoring the ones it retired', () => {
    // A row from the old scheme: it carries `prompts`, `recipe.*` and the
    // state-folding `prerequisites`, none of which exist any more, and lacks
    // the ones the scheme gained.
    const stored = { flow: components.flow, sections: components.sections, prompts: 'deadbeefdeadbeef', 'recipe.manifests': 'cafecafecafecafe', prerequisites: 'f00df00df00df00d' }
    expect(flowSettleVerdict({ prior: { generationInputsHash: legacyHash, generationInputs: stored }, components, legacyHash: 'sha256:other' }))
      .toEqual({ settled: true, moved: [] })
  })

  it('re-opens on a name both records carry that differs, and names it', () => {
    const stored = { ...components, sections: 'ffffffffffffffff' }
    expect(flowSettleVerdict({ prior: { generationInputsHash: legacyHash, generationInputs: stored }, components, legacyHash }))
      .toEqual({ settled: false, moved: ['sections'] })
  })

  it('checks a row with no names against the legacy hash, once, and names nothing', () => {
    expect(flowSettleVerdict({ prior: { generationInputsHash: legacyHash }, components, legacyHash }))
      .toEqual({ settled: true, moved: null })
    expect(flowSettleVerdict({ prior: { generationInputsHash: 'sha256:moved' }, components, legacyHash }))
      .toEqual({ settled: false, moved: null })
  })

  it('never settles a flow nothing has authored', () => {
    expect(flowSettleVerdict({ prior: undefined, components, legacyHash })).toEqual({ settled: false, moved: null })
    expect(flowSettleVerdict({ prior: { generationInputsHash: null }, components, legacyHash }))
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
      extractSession: extractSessionBy({ background: { untestable: 'design history' } }),
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

    // One of two docs lost (non-systemic, so extraction fails open) and one of
    // two areas lost the same way; matching then loses every call on the REAL
    // transport, which is what puts it in the audit's tally.
    const result = await generateGuards({
      repoRoot: r,
      interfaces: seams.interfaces,
      flowsEpicSession: seams.flowsEpicSession,
      flowWorkerSession: seams.flowWorkerSession,
      transport: async () => {
        throw new Error('the match transport died')
      },
      extractSession: async (input) => {
        const inner = await extractSessionBy({ background: { untestable: 'design history' } })(input)
        return {
          byDoc: inner.byDoc,
          summary: sessionSummary(EXTRACT_KIND, { ran: 2, failed: 1, firstError: 'transport died' }),
        }
      },
      flowsAreaSession: async (input) => {
        const inner = await seams.flowsAreaSession(input)
        return {
          byArea: inner.byArea,
          summary: sessionSummary(FLOWS_KIND, { ran: 2, failed: 1, firstError: 'transport died' }),
        }
      },
    })

    expect(result.status).toBe('llm-failed')
    expect(result.reason).toMatch(/guard\.match/)
    const byStage = new Map((result.llmFailures ?? []).map((f) => [f.stage, f]))
    // Both halves of the accounting: the transport audit's stage AND the two
    // session kinds it can never see.
    expect(byStage.get('guard.match')).toMatchObject({ attempts: 1, failures: 1 })
    expect(byStage.get(EXTRACT_KIND)).toMatchObject({ attempts: 2, failures: 1 })
    expect(byStage.get(FLOWS_KIND)).toMatchObject({ attempts: 2, failures: 1 })
    // Nothing was written.
    expect(fs.existsSync(path.join(r, '.truecourse', 'scenarios', 'manifest.json'))).toBe(false)
  })

  it('aborts on a systemic extraction loss before any session tally is lost', async () => {
    const r = seed()

    const result = await runGenerate({
      repoRoot: r,
      ...flowStageSeams(r),
      extractSession: extractSessionOf(new Map(), { ran: 1, failed: 1, allTransport: true, firstError: 'boom' }),
      flowsAreaSession: flowsAreaSessionOf(() => {
        throw new Error('synthesis must not run after a systemic extraction loss')
      }),
    })

    expect(result.status).toBe('llm-failed')
    expect((result.llmFailures ?? []).map((f) => f.stage)).toContain(EXTRACT_KIND)
  })
})
