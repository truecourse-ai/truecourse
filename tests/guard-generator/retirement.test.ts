/**
 * What the one-shot RETIREMENT (plan 04 step 20) left behind, pinned on the
 * three things a refactor could quietly break:
 *
 *  - the four session seams are REQUIRED options — a caller that forgets one
 *    must not compile, because there is no production fallback any more;
 *  - `flowGenerationInputsHash` FROZE the retired prompts' fingerprints as
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
  flowGenerationInputsHash,
  type GenerateGuardsOptions,
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

describe('flowGenerationInputsHash — the frozen retirement salt', () => {
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
  const GOLDEN = 'sha256:9403ee4cf224fd488980f0442bba14a1fdc155fe4347ba79c5d10e541e8914ba'

  it('is byte-identical to what the pre-retirement code produced', () => {
    expect(
      flowGenerationInputsHash({
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
      expect(flowGenerationInputsHash(moved)).not.toBe(flowGenerationInputsHash(base))
    }
    // Order-insensitive on both sorted lists.
    expect(
      flowGenerationInputsHash({ ...base, sectionKeys: ['b', 'a'], interfaceFingerprints: ['y', 'x'] }),
    ).toBe(flowGenerationInputsHash({ ...base, sectionKeys: ['a', 'b'], interfaceFingerprints: ['x', 'y'] }))
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
