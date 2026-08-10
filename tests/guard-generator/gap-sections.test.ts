/**
 * The manifest's GAP-SECTION record — the committed proof that a section which no
 * flow binds was nonetheless accounted for (every claim it states settled as a
 * coverage gap).
 *
 * Without it a gap section's settledness lives ONLY in the gitignored `.cache/`
 * KV stores, so the machine that generated sees a no-op while a CLONE of the very
 * same corpus re-plans those sections as work forever — the estimate re-prices
 * flow synthesis and the run reports them as changed. These tests pin the clone
 * case: the record travels in `scenarios/manifest.json`, so a fresh checkout with
 * no caches at all plans zero work.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { readManifest, writeManifest } from '@truecourse/guard-runner'
import { GUARD_FORMAT_VERSION } from '@truecourse/shared'
import { planGuardWork } from '@truecourse/guard-generator'
import { estimateGuardTokens } from '../../packages/core/src/services/llm/spec-estimate.js'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  bindsFor,
  raw,
  extractBy,
  authorBy,
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

/** The extraction a real run makes here: one cli claim, one untestable section. */
const extract = extractBy({ background: { untestable: 'design history only' } })
const author = authorBy({ version: raw('v', PASSING_STEPS) })

/** Delete the derived KV caches — what a fresh clone of the repo actually has. */
function deleteCaches(r: string): void {
  fs.rmSync(path.join(r, '.truecourse', '.cache'), { recursive: true, force: true })
}

function seedRepo(): string {
  const r = repo()
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, DOC_CONTENT)
  return r
}

describe('manifest gap sections — change detection', () => {
  it('a committed gap-section record makes an unchanged, flow-less section NOT work', () => {
    const r = seedRepo()
    const [version] = bindsFor(r, DOC, 'version')
    const [background] = bindsFor(r, DOC, 'background')

    // A manifest exactly as a completed generate leaves it: a flow binds the one
    // testable section, and the untestable one carries a gap-section record.
    writeManifest(r, {
      version: GUARD_FORMAT_VERSION,
      flows: [
        {
          flowId: 'version',
          flowFingerprint: 'sha256:flow',
          bindings: [{ doc: DOC, anchor: version.section, fingerprint: version.fingerprint }],
          scenarios: [{ id: 'version.cli.1', surface: 'cli', status: 'passing' }],
          journeys: [],
          generationInputsHash: 'sha256:settled',
          gaps: [],
        },
      ],
      gapSections: [{ doc: DOC, anchor: background.section, fingerprint: background.fingerprint }],
    })

    expect(planGuardWork(r).work).toEqual([])
  })

  it('re-opens the gap section when its text moves, and drops the record when it goes', () => {
    const r = seedRepo()
    const [version] = bindsFor(r, DOC, 'version')
    const [background] = bindsFor(r, DOC, 'background')

    // Both sections settled as gaps — nothing testable in this doc at all.
    writeManifest(r, {
      version: GUARD_FORMAT_VERSION,
      flows: [],
      gapSections: [
        { doc: DOC, anchor: version.section, fingerprint: version.fingerprint },
        { doc: DOC, anchor: background.section, fingerprint: background.fingerprint },
      ],
    })

    // Edited: the fingerprint moved, so the section is work again — exactly as a
    // flow-bound section re-opens when its binding fingerprint goes stale.
    writeDoc(r, DOC, DOC_CONTENT.replace('Design history', 'Design history, and a promise'))
    expect(planGuardWork(r).work.map((s) => s.anchor)).toEqual(['background'])

    // Deleted: the record has no live section and no scenario behind it, so it
    // simply drops out. It is NOT reported as an orphan — orphans are bindings
    // whose scenarios are kept, and a gap section never had one.
    writeDoc(r, DOC, '## version\n`relkit --version` prints the version and exits 0.\n')
    const plan = planGuardWork(r)
    expect(plan.work).toEqual([])
    expect(plan.orphaned).toEqual([])
  })

  it('an older manifest with no gap-section field behaves exactly as before', () => {
    const r = seedRepo()
    const [version] = bindsFor(r, DOC, 'version')
    writeManifest(r, {
      version: GUARD_FORMAT_VERSION,
      flows: [
        {
          flowId: 'version',
          flowFingerprint: 'sha256:flow',
          bindings: [{ doc: DOC, anchor: version.section, fingerprint: version.fingerprint }],
          scenarios: [{ id: 'version.cli.1', surface: 'cli', status: 'passing' }],
          journeys: [],
          generationInputsHash: 'sha256:settled',
          gaps: [],
        },
      ],
    })
    expect(planGuardWork(r).work.map((s) => s.anchor)).toEqual(['background'])
  })
})

describe('generate — gap sections travel in the manifest', () => {
  it('records every settled flow-less section, so a clone plans zero work', async () => {
    const r = seedRepo()

    const first = await runGenerate({ repoRoot: r, extractRunner: extract, generateRunner: author })
    expect(first.written).toHaveLength(1)

    // The untestable section settled as a permanent gap: no flow binds it, so the
    // manifest carries it as a gap-section record.
    const manifest = readManifest(r)
    expect(manifest?.gapSections).toEqual([
      { doc: DOC, anchor: 'background', fingerprint: bindsFor(r, DOC, 'background')[0].fingerprint },
    ])

    // THE CLONE: the committed store (scenarios + manifest + corpus + docs) with
    // every derived cache gone. Nothing spec-side changed, so nothing is work.
    deleteCaches(r)
    expect(planGuardWork(r).work).toEqual([])

    // ...and the estimate agrees: no section changed ⇒ flow synthesis is quoted at
    // zero calls and the stage vanishes entirely.
    const est = await estimateGuardTokens(r)
    expect(est.stages?.some((s) => s.stage === 'guardFlows')).toBe(false)
    expect(est.subjectLabel).toBe('all 2 sections cached')
  })

  it('a second generate over the same state reports no changed section', async () => {
    const r = seedRepo()
    await runGenerate({ repoRoot: r, extractRunner: extract, generateRunner: author })

    const second = await runGenerate({ repoRoot: r, extractRunner: extract, generateRunner: author })
    expect(second.sectionsChanged).toBe(0)
    expect(second.skippedUnchanged).toBe(2)
    expect(second.noChanges).toBe(true)
    // The record is rewritten identically — it is derived from the live sections.
    expect(readManifest(r)?.gapSections?.map((s) => s.anchor)).toEqual(['background'])
  })
})

/**
 * THE PRUNE PATH. A user dismissal (`scenarios/decisions.json` → `dismissedFlows`)
 * removes a flow and its scenarios. The section that flow alone bound is then
 * flowless — accounted for (its claims settled as `dismissed` gaps), so it must
 * leave a gap-section record like any other settled flowless section. And when the
 * dismissal is LIFTED it must come back as real work, not stay silently gapped.
 */
describe('generate — a dismissal that prunes a flow', () => {
  const TWO_SECTION_DOC = [
    '## version',
    '`relkit --version` prints the version and exits 0.',
    '',
    '## boom',
    '`relkit boom` exits non-zero.',
  ].join('\n')

  function writeDismissedFlow(r: string, flowIds: string[]): void {
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
          dismissedAt: '2026-08-01T00:00:00.000Z',
          note: 'not a user path',
        })),
      }),
    )
  }

  function twoSectionRepo(): string {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, TWO_SECTION_DOC)
    return r
  }

  const run = (r: string) =>
    runGenerate({ repoRoot: r, extractRunner: extractBy({}), generateRunner: authorBy({}) })

  it('records the pruned flow\'s section as a gap, so the next run has zero work', async () => {
    const r = twoSectionRepo()
    const first = await run(r)
    expect(first.written.map((w) => w.flowId).sort()).toEqual(['boom', 'version'])

    writeDismissedFlow(r, ['boom'])
    const second = await run(r)
    expect(second.flows.dismissed).toBe(1)
    expect(readManifest(r)?.flows.map((f) => f.flowId)).toEqual(['version'])
    // The dismissed flow's section is flowless but ACCOUNTED FOR.
    expect(readManifest(r)?.gapSections?.map((s) => s.anchor)).toEqual(['boom'])

    // ...so neither the plan nor the estimate has anything left to do — on this
    // machine or on a clone with no caches at all.
    expect(planGuardWork(r).work).toEqual([])
    deleteCaches(r)
    expect(planGuardWork(r).work).toEqual([])

    const third = await run(r)
    expect(third.sectionsChanged).toBe(0)
    expect(third.noChanges).toBe(true)
  })

  it('lifting the dismissal re-opens the section and re-authors its flow', async () => {
    const r = twoSectionRepo()
    await run(r)
    writeDismissedFlow(r, ['boom'])
    await run(r)
    expect(readManifest(r)?.gapSections?.map((s) => s.anchor)).toEqual(['boom'])

    // The user changed their mind. The section text never moved, so the gap record
    // still matches it — what re-opens it is the flow coming back: synthesis
    // produces `boom` again, it has no manifest entry, and it is authored.
    writeDismissedFlow(r, [])
    const res = await run(r)
    expect(res.written.map((w) => w.flowId)).toEqual(['boom'])
    expect(readManifest(r)?.flows.map((f) => f.flowId).sort()).toEqual(['boom', 'version'])
    // ...and the record retires: the section is bound again.
    expect(readManifest(r)?.gapSections ?? []).toEqual([])
    expect(planGuardWork(r).work).toEqual([])
  })
})

/**
 * ONE SECTION, MANY RECORDS. A section can be bound by several flows, and an
 * ORPHANED entry (synthesis stopped producing its flow, but its committed test is
 * real coverage) is carried forward UNTOUCHED — bindings frozen at the text they
 * were taken against. So the manifest legitimately holds several fingerprints for
 * one section, only some of which are current.
 *
 * Change detection must therefore ask "does ANY committed record match the live
 * text?", not "does the first record I happen to read match?". Reading one
 * arbitrary record made a fully-accounted section read as changed on every run and
 * in every estimate — for good, since its text never moves again.
 */
describe('manifest gap sections — a section with several records', () => {
  function flowEntryFor(
    flowId: string,
    binding: { doc: string; anchor: string; fingerprint: string },
    extra: { orphaned?: true } = {},
  ) {
    return {
      flowId,
      flowFingerprint: `sha256:${flowId}`,
      bindings: [binding],
      scenarios: [{ id: `${flowId}.cli.1`, surface: 'cli' as const, status: 'passing' as const }],
      journeys: [],
      generationInputsHash: `sha256:settled-${flowId}`,
      gaps: [],
      ...extra,
    }
  }

  it('is unchanged when ANY flow binds it at the live fingerprint', () => {
    const r = seedRepo()
    const [version] = bindsFor(r, DOC, 'version')
    const [background] = bindsFor(r, DOC, 'background')

    writeManifest(r, {
      version: GUARD_FORMAT_VERSION,
      flows: [
        // Carried forward from an older text — frozen, and first in manifest order.
        flowEntryFor('a-carried-flow', { doc: DOC, anchor: version.section, fingerprint: 'sha256:stale' }, {
          orphaned: true,
        }),
        // The flow that actually guards the section TODAY.
        flowEntryFor('version', { doc: DOC, anchor: version.section, fingerprint: version.fingerprint }),
      ],
      gapSections: [{ doc: DOC, anchor: background.section, fingerprint: background.fingerprint }],
    })

    expect(planGuardWork(r).work).toEqual([])
  })

  it('a stale binding never overrides the section\'s own gap record', () => {
    const r = seedRepo()
    const [version] = bindsFor(r, DOC, 'version')
    const [background] = bindsFor(r, DOC, 'background')

    writeManifest(r, {
      version: GUARD_FORMAT_VERSION,
      flows: [
        flowEntryFor('a-carried-flow', { doc: DOC, anchor: background.section, fingerprint: 'sha256:stale' }, {
          orphaned: true,
        }),
        flowEntryFor('version', { doc: DOC, anchor: version.section, fingerprint: version.fingerprint }),
      ],
      // The section settled as a gap against its CURRENT text.
      gapSections: [{ doc: DOC, anchor: background.section, fingerprint: background.fingerprint }],
    })

    expect(planGuardWork(r).work).toEqual([])
  })

  it('is still work when every record predates the current text', () => {
    const r = seedRepo()
    const [version] = bindsFor(r, DOC, 'version')
    const [background] = bindsFor(r, DOC, 'background')

    writeManifest(r, {
      version: GUARD_FORMAT_VERSION,
      flows: [
        flowEntryFor('a-carried-flow', { doc: DOC, anchor: version.section, fingerprint: 'sha256:stale' }, {
          orphaned: true,
        }),
      ],
      gapSections: [{ doc: DOC, anchor: background.section, fingerprint: background.fingerprint }],
    })

    expect(planGuardWork(r).work.map((s) => s.anchor)).toEqual(['version'])
  })

  it('a rewritten section whose flow orphans out settles as a gap, not as work forever', async () => {
    const r = seedRepo()
    await runGenerate({ repoRoot: r, extractRunner: extractBy({}), generateRunner: authorBy({}) })
    expect(readManifest(r)?.flows.map((f) => f.flowId).sort()).toEqual(['background', 'version'])

    // The section is REWRITTEN into prose nobody can falsify: its text moves and
    // extraction now returns an untestable note, so synthesis stops producing its
    // flow. The flow is orphaned WITH a test — carried forward untouched, binding
    // frozen at the old text — and nothing live binds the section any more.
    writeDoc(r, DOC, DOC_CONTENT.replace('Design history;', 'Design history, rewritten;'))
    const second = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({ background: { untestable: 'design history only' } }),
      generateRunner: authorBy({}),
    })
    expect(second.flows.orphaned).toBe(1)
    expect(readManifest(r)?.flows.find((f) => f.flowId === 'background')?.orphaned).toBe(true)

    // Its claims settled as gaps against the NEW text, so the new text is recorded.
    expect(readManifest(r)?.gapSections).toEqual([
      { doc: DOC, anchor: 'background', fingerprint: bindsFor(r, DOC, 'background')[0].fingerprint },
    ])
    expect(planGuardWork(r).work).toEqual([])
    deleteCaches(r)
    expect(planGuardWork(r).work).toEqual([])
  })
})
