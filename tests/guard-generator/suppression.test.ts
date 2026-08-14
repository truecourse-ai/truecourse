/**
 * Extraction suppression from section-scoped conflict resolutions.
 *
 * A conflict resolved by a SIDE verdict makes the loser's disputed sentence stale:
 * the guard generator injects a "resolved stale — extract no claim asserting this"
 * block into the losing section's extraction context, which re-keys ONLY the
 * affected view's extract cache (unaffected views keep theirs) and re-keys ONLY the
 * affected section's generation-inputs hash (so it re-detects as work). A dismissal
 * injects nothing.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  extractDocClaims,
  planGuardWork,
  readSuppressionIndex,
  suppressedQuotesIn,
  suppressionKey,
  sectionInputsKey,
  flowGenerationInputsHash,
  type ExtractRunner,
  type GuardDoc,
  type SectionInput,
} from '@truecourse/guard-generator'
import { writeManifest } from '@truecourse/guard-runner'

let repo = ''
afterEach(() => {
  if (repo) fs.rmSync(repo, { recursive: true, force: true })
  repo = ''
})

function tempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-suppress-'))
  fs.mkdirSync(path.join(dir, '.truecourse', 'specs'), { recursive: true })
  return dir
}

const QUOTE = 'rm archives the task, keeping history.'

/** corpus.json flagging README ↔ SPEC's rm dispute, with per-side quotes. */
function writeCorpus(dir: string): void {
  fs.writeFileSync(
    path.join(dir, '.truecourse', 'specs', 'corpus.json'),
    JSON.stringify({
      version: 3,
      generatedAt: '2026-01-01T00:00:00Z',
      docs: [
        { ref: 'README.md', kind: 'readme', lastTouched: '', areaTags: ['core/persistence'] },
        { ref: 'docs/SPEC.md', kind: 'spec', lastTouched: '', areaTags: ['core/persistence'] },
      ],
      areas: [
        {
          id: 'core/persistence',
          product: 'core',
          concern: 'persistence',
          docRefs: ['README.md', 'docs/SPEC.md'],
          overlaps: [
            {
              docs: ['README.md', 'docs/SPEC.md'],
              note: 'rm permanent vs archived',
              sections: [
                { doc: 'README.md', heading: 'taskline', quote: 'rm permanently deletes the task.' },
                { doc: 'docs/SPEC.md', heading: 'rm <id>', quote: QUOTE },
              ],
            },
          ],
        },
      ],
      relations: [],
      skippedDocs: [],
    }),
  )
}

function writeDecisions(dir: string, conflictResolutions: unknown[]): void {
  fs.writeFileSync(
    path.join(dir, '.truecourse', 'specs', 'decisions.json'),
    JSON.stringify({ version: 1, manualIncludes: [], manualExcludes: [], relations: [], manualAreas: [], conflictResolutions }),
  )
}

/** A single-view GuardDoc for docs/SPEC.md, optionally carrying suppressed quotes. */
function specDoc(suppressedQuotes: string[]): GuardDoc {
  const content = `# rm <id>\n${QUOTE}\n`
  const section: SectionInput = {
    doc: 'docs/SPEC.md',
    anchor: 'rm-id',
    fingerprint: 'sha256:deadbeef',
    headingText: 'rm <id>',
    level: 1,
    ownText: content,
    fullText: content,
    areaTags: ['core/persistence'],
    suppressionFingerprint: suppressionKey(suppressedQuotes),
  }
  return { doc: 'docs/SPEC.md', content, sections: [section], suppressedQuotes }
}

describe('suppression helpers', () => {
  it('suppressedQuotesIn matches by normalized substring; misses when absent', () => {
    expect(suppressedQuotesIn('before `rm archives`   the task, keeping history. after', [QUOTE])).toEqual([QUOTE])
    expect(suppressedQuotesIn('an unrelated section', [QUOTE])).toEqual([])
  })

  it('suppressionKey is empty for none and order-independent otherwise', () => {
    expect(suppressionKey([])).toBe('')
    expect(suppressionKey(['B one', 'a two'])).toBe(suppressionKey(['a two', 'B one']))
  })

  it('sectionInputsKey is byte-identical with no suppression, and moves with it', () => {
    const base = sectionInputsKey({ fingerprint: 'sha256:fp' })
    expect(sectionInputsKey({ fingerprint: 'sha256:fp', suppressionFingerprint: '' })).toBe(base)
    expect(sectionInputsKey({ fingerprint: 'sha256:fp', suppressionFingerprint: suppressionKey([QUOTE]) })).not.toBe(base)
  })

  it('the FLOW hash folds the section key, so a newly-suppressed section re-authors its flows', () => {
    const clean = sectionInputsKey({ fingerprint: 'sha256:fp' })
    const suppressed = sectionInputsKey({ fingerprint: 'sha256:fp', suppressionFingerprint: suppressionKey([QUOTE]) })
    const hash = (sectionKey: string) =>
      flowGenerationInputsHash({
        flowFingerprint: 'sha256:flow',
        sectionKeys: [sectionKey],
        interfaceFingerprints: ['sha256:interface'],
        recipeFingerprint: 'sha256:recipe',
      })
    expect(hash(clean)).not.toBe(hash(suppressed))
    expect(hash(clean)).toBe(hash(clean))
  })
})

describe('readSuppressionIndex', () => {
  it('names the LOSER’s quote for a side verdict; nothing for a dismissal', () => {
    repo = tempRepo()
    writeCorpus(repo)
    // verdict 'a' → README right, SPEC's sentence stale.
    writeDecisions(repo, [
      { docA: 'README.md', anchorA: 'taskline', quoteA: 'rm permanently deletes the task.', docB: 'docs/SPEC.md', anchorB: 'rm <id>', quoteB: QUOTE, verdict: 'a', resolvedAt: '' },
    ])
    expect(readSuppressionIndex(repo).get('docs/SPEC.md')).toEqual([QUOTE])

    writeDecisions(repo, [
      { docA: 'README.md', anchorA: 'taskline', docB: 'docs/SPEC.md', anchorB: 'rm <id>', verdict: 'dismissed', resolvedAt: '' },
    ])
    expect(readSuppressionIndex(repo).size).toBe(0)
  })

  it('is empty when no corpus / no decisions (tolerant)', () => {
    repo = tempRepo()
    expect(readSuppressionIndex(repo).size).toBe(0)
    writeCorpus(repo)
    expect(readSuppressionIndex(repo).size).toBe(0)
  })
})

describe('extraction suppression flow', () => {
  it('injects the block, re-keys only the affected view, and drops the loser claim', async () => {
    repo = tempRepo()
    const calls: Array<string[] | undefined> = []
    // The mock model emits the loser claim UNLESS its input flags it stale.
    const runner: ExtractRunner = async (ctx) => {
      calls.push(ctx.suppressed)
      const stale = (ctx.suppressed ?? []).length > 0
      return { claims: stale ? [] : [{ claim: 'rm archives the task', driver: 'cli', sectionAnchor: 'rm-id', reason: 'observable rm behavior' }], untestable: [] }
    }

    // 1) No suppression → runner called, ctx carries no block, claim extracted + cached.
    const r1 = await extractDocClaims(repo, specDoc([]), runner)
    expect(r1.ok).toBe(true)
    if (r1.ok) expect(r1.data.claims).toHaveLength(1)
    expect(calls).toEqual([undefined])

    // 2) Suppression added → cache MISS (key changed): runner re-called with the
    //    block, and the loser claim is dropped.
    const r2 = await extractDocClaims(repo, specDoc([QUOTE]), runner)
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(r2.data.claims).toHaveLength(0)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual([QUOTE])

    // 3) Back to no suppression → cache HIT on the ORIGINAL key: runner NOT called
    //    again (unaffected views keep their cache), original claim returned.
    const r3 = await extractDocClaims(repo, specDoc([]), runner)
    expect(calls).toHaveLength(2)
    if (r3.ok) expect(r3.data.claims).toHaveLength(1)
  })

  it('a dismissal injects nothing (runner sees no block)', async () => {
    repo = tempRepo()
    const seen: Array<string[] | undefined> = []
    const runner: ExtractRunner = async (ctx) => {
      seen.push(ctx.suppressed)
      return { claims: [{ claim: 'x', driver: 'cli', sectionAnchor: 'rm-id', reason: 'y' }], untestable: [] }
    }
    // A dismissed verdict yields no suppressed quotes, so the doc carries none.
    await extractDocClaims(repo, specDoc([]), runner)
    expect(seen).toEqual([undefined])
  })
})

describe('a side verdict re-keys the losing section', () => {
  it('an unchanged loser section keeps its text but gains a suppression key, moving its flow hash', () => {
    repo = tempRepo()
    fs.writeFileSync(path.join(repo, 'README.md'), '# taskline\nrm permanently deletes the task.\n')
    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'docs', 'SPEC.md'), `# rm <id>\n${QUOTE}\n`)
    writeCorpus(repo)
    fs.mkdirSync(path.join(repo, '.truecourse', 'scenarios'), { recursive: true })
    fs.writeFileSync(
      path.join(repo, '.truecourse', 'scenarios', 'recipe.json'),
      JSON.stringify({ build: 'true', entry: ['node', 'cli.js'] }),
    )

    // Baseline plan (no decisions): stamp a manifest as if one flow per section
    // generated, so a later plan skips every unchanged section.
    const plan0 = planGuardWork(repo)
    const flowHashOf = (s: (typeof plan0.sections)[number], recipeFingerprint: string) =>
      flowGenerationInputsHash({
        flowFingerprint: s.fingerprint,
        sectionKeys: [sectionInputsKey(s)],
        interfaceFingerprints: [],
        recipeFingerprint,
      })
    writeManifest(repo, {
      flows: plan0.sections.map((s) => ({
        flowId: `${s.doc}#${s.anchor}`,
        flowFingerprint: s.fingerprint,
        bindings: [{ doc: s.doc, anchor: s.anchor, fingerprint: s.fingerprint }],
        scenarios: [],
        generationInputsHash: flowHashOf(s, plan0.recipeFingerprint),
        gaps: [],
      })),
    })
    expect(planGuardWork(repo).work).toHaveLength(0)

    // README is right → SPEC's sentence is stale. SPEC is UNCHANGED on disk, so it is
    // NOT a changed section — but its suppression key moves, which moves the hash of
    // every flow binding it: those flows re-author with the stale claim suppressed,
    // while README's stay a no-op.
    writeDecisions(repo, [
      { docA: 'README.md', anchorA: 'taskline', quoteA: 'rm permanently deletes the task.', docB: 'docs/SPEC.md', anchorB: 'rm <id>', quoteB: QUOTE, verdict: 'a', resolvedAt: '' },
    ])
    const plan1 = planGuardWork(repo)
    expect(plan1.work).toHaveLength(0) // no document changed on disk

    const before = new Map(plan0.sections.map((s) => [`${s.doc}#${s.anchor}`, flowHashOf(s, plan0.recipeFingerprint)]))
    const moved = plan1.sections.filter(
      (s) => before.get(`${s.doc}#${s.anchor}`) !== flowHashOf(s, plan1.recipeFingerprint),
    )
    expect(moved.map((s) => s.doc)).toEqual(['docs/SPEC.md'])
    expect(moved[0].suppressionFingerprint).not.toBe('')
  })
})
