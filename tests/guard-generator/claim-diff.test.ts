/**
 * The claim-diff gate: an edited spec section re-authors the flows bound to it
 * ONLY when the edit changed an obligation. A cosmetic edit keeps the document's
 * prior extraction (reused through the seam), leaves every flow unchanged, and
 * re-stamps the manifest so the following generate is a genuine no-op.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { planGuardWork, type ReuseExtractionSeam, type PriorExtraction } from '@truecourse/guard-generator'
import { readManifest, writeManifest } from '@truecourse/guard-runner'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  extractSessionBy,
  runGenerate,
  submitWorkerSessions,
  PASSING_STEPS,
} from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

const DOC = 'docs/cli.md'
const DOC_CONTENT = [
  '## version',
  '`relkit --version` prints the version and exits 0.',
  '',
  '## background',
  'The history of relkit; nothing externally observable here.',
].join('\n')
const COSMETIC_EDIT = DOC_CONTENT.replace('prints the version and exits 0.', 'prints the version, then exits 0.')

/** What the first generate's (stubbed) extraction said about the doc — the
 *  outcome a real run would have cached under the doc's content hash. */
const PRIOR: PriorExtraction = {
  claims: [{ claim: 'version claim', driver: 'cli', sectionAnchor: 'version', reason: 'exit code is observable' }],
  untestable: [{ sectionAnchor: 'background', reason: 'design history, nothing observable' }],
}

const extraction = () => extractSessionBy({ background: { untestable: 'design history, nothing observable' } })

function seed(): string {
  const r = makeTempRepo()
  repos.push(r)
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
  writeDoc(r, DOC, DOC_CONTENT)
  return r
}

/** A reuse seam over an in-memory "cache": `lookup` answers PRIOR for the
 *  hash the first generate recorded; `reuse` only records the call. */
function reuseSeam(): ReuseExtractionSeam & { reused: string[]; lookups: string[] } {
  const seam = {
    reused: [] as string[],
    lookups: [] as string[],
    async lookup(doc: { doc: string }, priorContentHash: string) {
      seam.lookups.push(`${doc.doc}@${priorContentHash}`)
      return PRIOR
    },
    async reuse(doc: { doc: string }) {
      seam.reused.push(doc.doc)
    },
  }
  return seam
}

async function generate(
  r: string,
  opts: {
    seam?: ReuseExtractionSeam
    verdict?: 'cosmetic' | 'changed' | 'throw'
    workerTasks?: string[]
  } = {},
) {
  const res = await runGenerate({
    repoRoot: r,
    extractSession: extraction(),
    ...(opts.seam ? { reuseExtraction: opts.seam } : {}),
    claimDiffRunner: async () => {
      if (opts.verdict === 'throw') throw new Error('gate down')
      return { verdict: opts.verdict ?? 'cosmetic', reason: 'stubbed' }
    },
    flowWorkerSession: submitWorkerSessions(() => raw('relkit --version prints the version', PASSING_STEPS), {
      onBriefing: (task) => opts.workerTasks?.push(task.workItem),
    }),
  })
  expect(res.status).toBe('ok')
  return res
}

describe('claim-diff gate — cosmetic doc edits do not re-author', () => {
  it('records every extracted document with its content hash in the manifest', async () => {
    const r = seed()
    await generate(r)
    const docs = readManifest(r)!.docs ?? []
    expect(docs.map((d) => d.doc)).toEqual([DOC])
    expect(docs[0]!.contentHash).toMatch(/^[0-9a-f]{64}$/)
  }, 60_000)

  it('a cosmetic edit reuses the prior extraction, leaves the flow unchanged, and re-stamps the manifest', async () => {
    const r = seed()
    const first = await generate(r)
    expect(first.written.length).toBe(1)
    const before = readManifest(r)!
    const priorHash = before.docs![0]!.contentHash

    writeDoc(r, DOC, COSMETIC_EDIT)
    expect(planGuardWork(r).work.map((s) => s.anchor)).toEqual(['version'])

    const seam = reuseSeam()
    const workerTasks: string[] = []
    const res = await generate(r, { seam, verdict: 'cosmetic', workerTasks })

    // The gate asked once, found the prior under the recorded hash, and reused it.
    expect(res.claimDiffCalls).toBe(1)
    expect(seam.lookups).toEqual([`${DOC}@${priorHash}`])
    expect(seam.reused).toEqual([DOC])
    expect(res.cosmeticSections).toBe(1)
    // No flow re-authored: nothing written, no worker briefed, a no-op run.
    expect(workerTasks).toEqual([])
    expect(res.written).toEqual([])
    expect(res.noChanges).toBe(true)

    // The manifest now carries the NEW fingerprint and a settled hash, so the
    // planner has nothing to do and the gate has nothing to judge next time.
    const after = readManifest(r)!
    const flow = after.flows[0]!
    expect(flow.generationInputsHash).toMatch(/^sha256:/)
    expect(flow.bindings.find((b) => b.anchor === 'version')!.fingerprint).not.toBe(
      before.flows[0]!.bindings.find((b) => b.anchor === 'version')!.fingerprint,
    )
    expect(after.docs![0]!.contentHash).not.toBe(priorHash)
    expect(planGuardWork(r).work).toEqual([])
    const again = await generate(r, { seam: reuseSeam(), verdict: 'cosmetic', workerTasks })
    expect(again.claimDiffCalls).toBe(0)
    expect(again.noChanges).toBe(true)
    expect(workerTasks).toEqual([])
  }, 90_000)

  it('a `changed` verdict re-extracts and re-authors exactly as before the gate', async () => {
    const r = seed()
    await generate(r)
    writeDoc(r, DOC, COSMETIC_EDIT)

    const seam = reuseSeam()
    const workerTasks: string[] = []
    const res = await generate(r, { seam, verdict: 'changed', workerTasks })
    expect(res.claimDiffCalls).toBe(1)
    expect(seam.reused).toEqual([])
    expect(res.cosmeticSections).toBe(0)
    expect(workerTasks.length).toBe(1)
    expect(res.written.length).toBe(1)
  }, 90_000)

  it('a gate failure fails closed: the document re-extracts, the flow re-authors, the loss is reported', async () => {
    const r = seed()
    await generate(r)
    writeDoc(r, DOC, COSMETIC_EDIT)

    const seam = reuseSeam()
    const workerTasks: string[] = []
    const res = await generate(r, { seam, verdict: 'throw', workerTasks })
    expect(res.claimDiffCalls).toBe(2)
    expect(seam.reused).toEqual([])
    expect(workerTasks.length).toBe(1)
    expect(res.errors.some((e) => e.message.includes('claim-diff gate could not judge'))).toBe(true)
  }, 90_000)

  it('a manifest without recorded docs skips the gate', async () => {
    const r = seed()
    await generate(r)
    const manifest = readManifest(r)!
    const { docs: _docs, ...legacy } = manifest
    writeManifest(r, legacy)
    writeDoc(r, DOC, COSMETIC_EDIT)

    const seam = reuseSeam()
    const workerTasks: string[] = []
    const res = await generate(r, { seam, verdict: 'cosmetic', workerTasks })
    expect(res.claimDiffCalls).toBe(0)
    expect(seam.lookups).toEqual([])
    expect(workerTasks.length).toBe(1)
  }, 90_000)

  it('an edit that adds a section is never judged section-by-section', async () => {
    const r = seed()
    await generate(r)
    writeDoc(r, DOC, `${COSMETIC_EDIT}\n\n## install\n\`relkit install\` exits 0.`)

    const seam = reuseSeam()
    const workerTasks: string[] = []
    const res = await generate(r, { seam, verdict: 'cosmetic', workerTasks })
    expect(res.claimDiffCalls).toBe(0)
    expect(seam.reused).toEqual([])
    // The reworded version section re-authors its flow through the ordinary gate.
    expect(workerTasks.some((w) => w.includes('version'))).toBe(true)
  }, 90_000)

  it('judges only the section whose own text moved; an untouched ancestor inherits the verdict', async () => {
    // Section text is descendant-inclusive, so an edit under `### child` also
    // moves `## parent`'s fingerprint. The parent's OWN prose did not change, so
    // it is never judged by itself: it is cosmetic because the child was.
    const NESTED = ['## parent', 'Overview prose with nothing observable.', '', '### child', '`relkit --version` prints the version and exits 0.'].join('\n')
    const r = makeTempRepo()
    repos.push(r)
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
    writeDoc(r, DOC, NESTED)
    const nestedExtraction = () => extractSessionBy({ parent: { untestable: 'overview only' } })
    const first = await runGenerate({
      repoRoot: r,
      extractSession: nestedExtraction(),
      flowWorkerSession: submitWorkerSessions(() => raw('relkit --version prints the version', PASSING_STEPS)),
    })
    expect(first.status).toBe('ok')
    expect(first.written.length).toBe(1)

    writeDoc(r, DOC, NESTED.replace('prints the version and exits 0.', 'prints the version, then exits 0.'))
    const judged: { anchor: string; oldText: string; newText: string; priorClaims: readonly { claim: string }[] }[] = []
    const seam: ReuseExtractionSeam = {
      async lookup() {
        return {
          claims: [{ claim: 'parent/child claim', driver: 'cli', sectionAnchor: 'parent/child', reason: 'exit code is observable' }],
          untestable: [{ sectionAnchor: 'parent', reason: 'overview only' }],
        }
      },
      async reuse() {},
    }
    const res = await runGenerate({
      repoRoot: r,
      extractSession: nestedExtraction(),
      reuseExtraction: seam,
      claimDiffRunner: async (section) => {
        judged.push({ anchor: section.anchor, oldText: section.oldText, newText: section.newText, priorClaims: section.priorClaims })
        return { verdict: 'cosmetic', reason: 'stubbed' }
      },
      flowWorkerSession: submitWorkerSessions(() => raw('relkit --version prints the version', PASSING_STEPS)),
    })
    expect(res.status).toBe('ok')
    // Only the child was judged — on its own before/after text and its own
    // claim — and the parent inherited the cosmetic verdict.
    expect(judged.map((j) => j.anchor)).toEqual(['parent/child'])
    expect(judged[0]!.oldText).toContain('prints the version and exits 0.')
    expect(judged[0]!.newText).toContain('prints the version, then exits 0.')
    expect(judged[0]!.priorClaims.map((c) => c.claim)).toEqual(['parent/child claim'])
    expect(res.claimDiffCalls).toBe(1)
    expect(res.cosmeticSections).toBe(2)
    expect(res.written).toEqual([])
  }, 90_000)

  it('no reuse seam means no gate: the pre-gate behavior is untouched', async () => {
    const r = seed()
    await generate(r)
    writeDoc(r, DOC, COSMETIC_EDIT)
    const workerTasks: string[] = []
    const res = await generate(r, { verdict: 'cosmetic', workerTasks })
    expect(res.claimDiffCalls).toBe(0)
    expect(workerTasks.length).toBe(1)
  }, 90_000)
})
