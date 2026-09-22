/**
 * The claims arm of reconciliation, end to end through `generateGuards`: an
 * edit to one section hands the extraction seam the document's prior with the
 * untouched section SETTLED, the settled section's claim comes back byte for
 * byte, a reworded claim that names what it replaces keeps its stored id, and
 * the flows follow — the untouched flow kept, the reworded one amended, never
 * retired and re-invented.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import {
  type ExtractPrior,
  type ExtractResult,
  type ExtractSessionSeam,
  type PriorExtraction,
  type ReuseExtractionSeam,
} from '@truecourse/guard-generator'
import { readGuardClaimsCorpus, readGuardFlowsCorpus } from '@truecourse/guard-runner'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  extractSessionBy,
  runGenerate,
  sessionSummary,
  submitWorkerSessions,
  EXTRACT_KIND,
  PASSING_STEPS,
} from './helpers.js'
import { installMemoryKvCache, resetKvCacheStore } from '../helpers/memory-kv-cache.js'

const repos: string[] = []
beforeEach(() => {
  installMemoryKvCache()
})
afterEach(() => {
  resetKvCacheStore()
  while (repos.length) rmrf(repos.pop()!)
})

const DOC = 'docs/cli.md'
const CONTENT = [
  '## version',
  '`relkit --version` prints the version and exits 0.',
  '',
  '## help',
  '`relkit --help` prints the usage and exits 0.',
].join('\n')
/** The help section reworded in substance; the version section untouched. */
const EDITED = CONTENT.replace('prints the usage and exits 0.', 'prints the usage, one command per line, and exits 0.')

const VERSION = 'relkit --version prints the version'
const HELP = 'relkit --help prints the usage'
const HELP_REWORDED = 'relkit --help prints the usage, one command per line'

const versionClaim = { claim: VERSION, driver: 'cli' as const, sectionAnchor: 'version', reason: 'stdout carries the version', needs: [] }
const helpClaim = { claim: HELP, driver: 'cli' as const, sectionAnchor: 'help', reason: 'stdout carries the usage', needs: [] }

function seed(): string {
  const r = makeTempRepo()
  repos.push(r)
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
  writeDoc(r, DOC, CONTENT)
  return r
}

/** What the first generate's extraction said, as a cache would hold it. */
const FIRST: PriorExtraction = { claims: [versionClaim, helpClaim], untestable: [] }

/** A reuse seam answering the first extraction for whatever hash is asked. */
const reuseSeam: ReuseExtractionSeam = {
  async lookup() {
    return FIRST
  },
  async reuse() {},
}

const workers = (tasks: string[]) =>
  submitWorkerSessions((task) => raw(`${task.flowId} passes`, PASSING_STEPS), { onBriefing: (task) => tasks.push(task.workItem) })

describe('an edited section reconciles its claims and its flows', () => {
  it('settles the untouched section, carries the reworded claim’s id, keeps one flow and amends the other', async () => {
    const r = seed()
    const firstTasks: string[] = []
    const first = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({ version: [{ claim: VERSION, reason: versionClaim.reason }], help: [{ claim: HELP, reason: helpClaim.reason }] }),
      flowWorkerSession: workers(firstTasks),
    })
    expect(first.status).toBe('ok')
    expect(firstTasks).toHaveLength(2)
    const storedBefore = readGuardClaimsCorpus(r)!
    const helpId = storedBefore.claims.find((c) => c.title === HELP)!.id
    const flowsBefore = readGuardFlowsCorpus(r)!.flows
    const versionFlow = flowsBefore.find((f) => f.milestones[0]!.claimTitle === VERSION)!
    const helpFlow = flowsBefore.find((f) => f.milestones[0]!.claimTitle === HELP)!

    writeDoc(r, DOC, EDITED)

    // The extraction seam a reconciling session would be: it receives the
    // prior with the untouched section settled, and answers the settled
    // section's claim verbatim beside the reworded one naming what it replaces.
    let received: ExtractPrior | undefined
    const reconciling: ExtractSessionSeam = async ({ docs, priors, onDoc }) => {
      received = priors?.get(DOC)
      const byDoc = new Map<string, ExtractResult>()
      for (const doc of docs) {
        byDoc.set(doc.doc, {
          ok: true,
          data: { claims: [versionClaim, { ...helpClaim, claim: HELP_REWORDED, replaces: HELP }], untestable: [] },
          complete: true,
          failedViews: 0,
        })
      }
      onDoc?.(docs.length, docs.length)
      return { byDoc, summary: sessionSummary(EXTRACT_KIND, { ran: docs.length }) }
    }
    const secondTasks: string[] = []
    const second = await runGenerate({
      repoRoot: r,
      extractSession: reconciling,
      reuseExtraction: reuseSeam,
      claimDiffRunner: async () => ({ verdict: 'changed', reason: 'the usage format moved' }),
      flowWorkerSession: workers(secondTasks),
    })
    expect(second.status).toBe('ok')

    // The prior handed to the seam: both claims, the version section settled.
    expect(received).toEqual({ claims: [versionClaim, helpClaim], untestable: [], settledAnchors: ['version'] })

    // The store: the reworded claim took its prior row over under the same id.
    const storedAfter = readGuardClaimsCorpus(r)!
    expect(storedAfter.claims.map((c) => c.title).sort()).toEqual([HELP_REWORDED, VERSION].sort())
    expect(storedAfter.claims.find((c) => c.title === HELP_REWORDED)!.id).toBe(helpId)

    // The flows: the untouched one byte-identical, the reworded one amended in place.
    const flowsAfter = readGuardFlowsCorpus(r)!.flows
    expect(flowsAfter.find((f) => f.id === versionFlow.id)).toEqual(versionFlow)
    const amended = flowsAfter.find((f) => f.id === helpFlow.id)!
    expect(amended.milestones[0]!.claimTitle).toBe(HELP_REWORDED)
    expect(amended.fingerprint).not.toBe(helpFlow.fingerprint)
    expect(second.flows.reconciled).toEqual({ kept: 1, amended: 1, added: 0, retired: 0, carried: 0 })

    // And only the amended flow's scenario was re-authored.
    expect(secondTasks).toHaveLength(1)
    expect(secondTasks[0]).toContain(helpFlow.id)
  }, 90_000)
})
