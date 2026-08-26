/**
 * THE DOC CURATION SESSION — `spec-scan.curate-doc`, one per doc. What is
 * under test is the RUN around the session: which docs reach
 * a session at all, what the deterministic backstops do to a verdict after it
 * lands, how a failure falls open, and when a systemic loss aborts the write.
 *
 * Everything drives the real `runSpecScanSessions` / `curateInProcess` through
 * the driver seam with a scripted driver — no provider, no network.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resetKvCacheStore } from '@truecourse/llm'
import { LlmStageFailureError } from '@truecourse/shared/llm'
import { runSpecScanSessions } from '../../packages/core/src/services/spec-scan/run'
import {
  CURATE_DOC_SESSION_KIND,
  CURATE_DOC_SYSTEM_PROMPT,
  curateDocBriefing,
  curateDocCacheKey,
} from '../../packages/core/src/services/spec-scan/curate-doc'
import { curateInProcess } from '../../packages/core/src/commands/spec-in-process'
import {
  corpusFilePath,
  readCorpus,
  type DecisionsFile,
  type RepoIdentity,
} from '../../packages/spec-consolidator/src/index.js'
import {
  docPathOf,
  memoryPersistence,
  outcome,
  malformedFailure,
  stubDriver,
  toolResult,
  transportFailure,
  type StubCall,
  type StubScript,
} from './spec-scan-session-stub'

let repo: string

beforeEach(() => {
  resetKvCacheStore()
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-scan-curate-'))
})

afterEach(() => {
  resetKvCacheStore()
  fs.rmSync(repo, { recursive: true, force: true })
})

function writeDoc(rel: string, body: string): void {
  const abs = path.join(repo, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, body)
}

/** Two ordinary spec docs under `docs/` — the baseline universe. */
function twoDocs(): void {
  writeDoc('docs/users.md', '# Users\nStatus: shipped\nThe user entity has an id and an email address.\n')
  writeDoc('docs/auth.md', '# Auth\nStatus: shipped\nSessions authenticate users with a bearer token.\n')
}

const IDENTITY: RepoIdentity = {
  name: 'Relkit',
  description: 'a release toolkit',
  aliases: ['Relkit', 'relkit'],
  sources: ['test'],
}

/**
 * Decisions whose scope verdicts cover the whole universe, so the scan spends
 * ZERO orchestrator sessions (step 6's deterministic pre-pass) and the case
 * under test is the curation pool alone.
 */
function covering(dirs: readonly string[], extra: Partial<DecisionsFile> = {}): DecisionsFile {
  return {
    version: 2,
    manualIncludes: [],
    manualExcludes: [],
    manualAreas: [],
    conflictResolutions: [],
    instructions: [],
    ...extra,
    scopeVerdicts: ['.', ...dirs].map((p) => ({
      path: p,
      verdict: 'keep' as const,
      reason: 'covered by the test',
      decidedAt: '2026-01-01T00:00:00.000Z',
      resolvedBy: 'user' as const,
    })),
  }
}

const KEEP = (concern: string): unknown => ({
  keep: true,
  reason: 'states our behavior',
  subject: 'this-product',
  areas: [{ product: 'core', concern }],
  status: 'shipped',
})

/** A settlement that changes nothing — the settle session is not what these cases test. */
const NO_SETTLEMENT = { concernMerges: {}, productMerges: {}, productVerdicts: [], subdivisions: [] }

/**
 * Wrap a curate-doc script so the settle-areas barrier answers cleanly
 * (validator called, empty settlement) instead of dying malformed and
 * polluting the tallies these cases read.
 */
function scanScript(curateDoc: (call: StubCall) => ReturnType<StubScript>): StubScript {
  return async (call) => {
    if (call.kind === 'spec-scan.settle-areas') {
      await call.emit(toolResult('check_settlement', 'The settlement is valid.'))
      return outcome(NO_SETTLEMENT)
    }
    return curateDoc(call)
  }
}

/** Only the curate-doc runs, by the doc each was briefed on. */
const curatedDocs = (calls: readonly StubCall[]): string[] =>
  calls.filter((c) => c.kind === CURATE_DOC_SESSION_KIND).map((c) => docPathOf(c.briefing))

interface RunOptions {
  decisions: DecisionsFile
  driver: () => Promise<import('../../packages/agent-loop/src/index').SessionDriver>
  identity?: RepoIdentity | null
}

function runScan(opts: RunOptions) {
  return runSpecScanSessions({
    repoRoot: repo,
    driver: opts.driver,
    persistence: memoryPersistence().persistence,
    decisions: opts.decisions,
    repoIdentity: opts.identity === undefined ? IDENTITY : opts.identity,
    skipGit: true,
    disableOverlapDetection: true,
    concurrency: 2,
  })
}

const docCandidate = (p: string, content: string) => ({
  path: p,
  absPath: '',
  content,
  kind: 'prd' as const,
  preview: content.split('\n').slice(0, 5).join('\n'),
  lastTouched: '2026-01-01T00:00:00Z',
  contentHash: `hash-${p}`,
  size: content.length,
})

// ---------------------------------------------------------------------------
// the prompt and the briefing (inherited from the retired relevance one-shot)
// ---------------------------------------------------------------------------

describe('the curate-doc prompt and briefing', () => {
  // The judgment is subject-first, decided against the identity block, and the
  // rules carry no overfitted vocabulary — no repo layout words, no product names.
  it('the system prompt is general and subject-first', () => {
    expect(CURATE_DOC_SYSTEM_PROMPT).toMatch(/STEP 1 — SUBJECT/)
    expect(CURATE_DOC_SYSTEM_PROMPT).toMatch(/Quality is not evidence of ownership/)
    expect(CURATE_DOC_SYSTEM_PROMPT).toMatch(/IDENTITY/)
    expect(CURATE_DOC_SYSTEM_PROMPT).toMatch(/different-product/)
    expect(CURATE_DOC_SYSTEM_PROMPT).toMatch(/this-product/)
    expect(CURATE_DOC_SYSTEM_PROMPT).not.toMatch(/fixture|sample|test.?(data|tree)|truecourse/i)
    // …and it carries the AREA half the tagger one-shot used to own.
    expect(CURATE_DOC_SYSTEM_PROMPT).toMatch(/STEP 3 — AREAS/)
    expect(CURATE_DOC_SYSTEM_PROMPT).toMatch(/product.{0,3}: .?core/)
  })

  it('the briefing states the doc PATH and the repo identity', () => {
    const fixturePath = 'tests/fixtures/sample-js-project-il/reference/specs/modules/orders/data.md'
    const doc = docCandidate(fixturePath, '# Orders\nThe order entity has an id.\n')
    const briefing = curateDocBriefing(doc, IDENTITY)
    expect(briefing).toMatch(/PATH \(repo-relative\)/)
    expect(briefing).toContain(fixturePath)
    expect(briefing).toMatch(/IDENTITY/)
    expect(briefing).toContain('Relkit')
    // No identity ⇒ no identity block at all.
    expect(curateDocBriefing(doc, null)).not.toMatch(/IDENTITY/)
  })

  // The verdict cache must not survive a change of who we think we are.
  it('the cache key folds the identity, the path and the content hash', () => {
    const doc = { path: 'docs/api.md', contentHash: 'h1' }
    const key = curateDocCacheKey({ identity: IDENTITY, doc })
    expect(key).toBe(curateDocCacheKey({ identity: IDENTITY, doc }))
    expect(curateDocCacheKey({ identity: null, doc })).not.toBe(key)
    expect(
      curateDocCacheKey({ identity: { ...IDENTITY, name: 'Otherkit' }, doc }),
    ).not.toBe(key)
    expect(curateDocCacheKey({ identity: IDENTITY, doc: { ...doc, contentHash: 'h2' } })).not.toBe(key)
    expect(curateDocCacheKey({ identity: IDENTITY, doc: { ...doc, path: 'docs/other.md' } })).not.toBe(key)
    // The instructions tail (step 6) moves every scan key.
    expect(curateDocCacheKey({ identity: IDENTITY, doc }, ['fp'])).not.toBe(key)
  })
})

// ---------------------------------------------------------------------------
// the cache
// ---------------------------------------------------------------------------

describe('spec-scan.curate-doc — the per-doc session cache', () => {
  it('spends zero sessions on a second run and reports noChanges', async () => {
    twoDocs()
    const decisions = covering(['docs'])
    const first = stubDriver(
      scanScript(({ briefing }) =>
        outcome(KEEP(docPathOf(briefing).includes('auth') ? 'auth' : 'users entity')),
      ),
    )

    const cold = await runScan({ decisions, driver: async () => first.driver })
    expect(curatedDocs(first.calls).sort()).toEqual(['docs/auth.md', 'docs/users.md'])
    expect(cold.noChanges).toBe(false)

    // One cache entry per curated doc, under the NEW name.
    const cacheDir = path.join(repo, '.truecourse', '.cache', 'consolidator', 'curate-doc')
    expect(fs.readdirSync(cacheDir).filter((f) => f.endsWith('.json'))).toHaveLength(2)

    // The second run must not even resolve a driver: every doc is a hit.
    const warm = await runScan({
      decisions,
      driver: async () => {
        throw new Error('the driver was resolved on a fully cached run')
      },
    })
    expect(warm.noChanges).toBe(true)
    expect(warm.sessions.find((s) => s.kind === CURATE_DOC_SESSION_KIND)).toMatchObject({
      ran: 0,
      fromCache: 2,
    })
    expect(warm.corpus.docs.map((d) => d.ref).sort()).toEqual(cold.corpus.docs.map((d) => d.ref).sort())
    expect(warm.corpus.areas.map((a) => a.id).sort()).toEqual(cold.corpus.areas.map((a) => a.id).sort())
  })

  it('never caches a failed session — only the failed doc re-sessions', async () => {
    twoDocs()
    const decisions = covering(['docs'])
    const first = stubDriver(
      scanScript(({ briefing }) =>
        docPathOf(briefing).includes('auth') ? malformedFailure() : outcome(KEEP('users entity')),
      ),
    )
    await runScan({ decisions, driver: async () => first.driver })

    const second = stubDriver(scanScript(() => outcome(KEEP('auth'))))
    const warm = await runScan({ decisions, driver: async () => second.driver })
    expect(curatedDocs(second.calls)).toEqual(['docs/auth.md'])
    expect(warm.sessions.find((s) => s.kind === CURATE_DOC_SESSION_KIND)).toMatchObject({
      ran: 1,
      fromCache: 1,
    })
  })
})

// ---------------------------------------------------------------------------
// what never reaches the pool
// ---------------------------------------------------------------------------

describe('spec-scan.curate-doc — the deterministic prefilter runs BEFORE the pool', () => {
  it('prefiltered docs get no session and land in skippedDocs with their category', async () => {
    twoDocs()
    writeDoc('docs/archive/old.md', '# Old plan\nThe user entity used to carry a nickname.\n')
    writeDoc('CLAUDE.md', '# Claude\nInstructions for the coding agent working in this repo.\n')
    writeDoc(
      'CHANGELOG.md',
      '# Changelog\n\n## 1.2.0\n- added things\n\n## 1.1.0\n- fixed things\n\n## 1.0.0\n- first\n',
    )
    const decisions = covering(['docs'])
    const stub = stubDriver(
      scanScript(({ briefing }) =>
        outcome(KEEP(docPathOf(briefing).includes('auth') ? 'auth' : 'users entity')),
      ),
    )

    const result = await runScan({ decisions, driver: async () => stub.driver })

    expect(curatedDocs(stub.calls).sort()).toEqual(['docs/auth.md', 'docs/users.md'])

    const byRef = new Map(result.corpus.skippedDocs.map((s) => [s.ref, s]))
    expect(byRef.get('docs/archive/old.md')).toMatchObject({ category: 'superseded' })
    expect(byRef.get('CLAUDE.md')).toMatchObject({ category: 'agent-meta' })
    expect(byRef.get('CHANGELOG.md')).toMatchObject({ category: 'status-tracking' })
  })
})

// ---------------------------------------------------------------------------
// the deterministic backstops, in the fold
// ---------------------------------------------------------------------------

describe('spec-scan.curate-doc — the fold backstops', () => {
  it("a `different-product` subject skips the doc as third-party even when the session said keep", async () => {
    writeDoc('docs/vendor.md', '# ServiceTitan API\nThe dispatch board exposes a jobs endpoint.\n')
    const decisions = covering(['docs'])
    const stub = stubDriver(() =>
      outcome({
        keep: true,
        reason: 'looks like a real spec',
        subject: 'different-product',
        areas: [{ product: 'core', concern: 'dispatch' }],
        status: null,
      }),
    )

    const result = await runScan({ decisions, driver: async () => stub.driver })

    expect(result.corpus.docs.map((d) => d.ref)).not.toContain('docs/vendor.md')
    expect(result.corpus.skippedDocs).toContainEqual(
      expect.objectContaining({ ref: 'docs/vendor.md', category: 'third-party' }),
    )
    expect(result.stats.thirdPartyDropped).toBe(1)
    expect(result.stats.thirdPartyRestored).toBe(0)
  })

  it('the alias backstop reinstates a third-party drop whose prose names our product', async () => {
    writeDoc(
      'docs/ours.md',
      '# Release notes API\nRelkit publishes a release manifest for every tagged build.\n',
    )
    const decisions = covering(['docs'])
    const stub = stubDriver(() =>
      outcome({
        keep: false,
        reason: 'reads like vendor documentation',
        subject: 'different-product',
        category: 'third-party',
        areas: [{ product: 'core', concern: 'releases' }],
        status: null,
      }),
    )

    const result = await runScan({ decisions, driver: async () => stub.driver })

    expect(result.stats.thirdPartyDropped).toBe(1)
    expect(result.stats.thirdPartyRestored).toBe(1)
    const doc = result.corpus.docs.find((d) => d.ref === 'docs/ours.md')
    expect(doc).toBeDefined()
    // The verdict's areas survive the reinstatement — the doc is tagged, not just kept.
    expect(doc!.areaTags).toEqual(['core/releases'])
  })

  // Inherited from the retired `tagDocs` stage: the classifier's status wins,
  // and the deterministic header parse is the backstop behind it.
  it('takes the status from the verdict, falling back to the header parse', async () => {
    writeDoc('docs/a.md', '# A\nStatus: shipped\nThe A endpoint returns a list.\n')
    writeDoc('docs/b.md', '# B\nStatus: shipped\nThe B endpoint returns one item.\n')
    writeDoc('docs/c.md', '# C\nStatus: shipped\nThe C endpoint deletes one item.\n')
    const decisions = covering(['docs'])
    const stub = stubDriver(
      scanScript(({ briefing }) => {
        const doc = docPathOf(briefing)
        const status = doc.endsWith('a.md') ? 'deferred' : doc.endsWith('b.md') ? null : 'purple'
        return outcome({
          keep: true,
          reason: 'ok',
          subject: 'this-product',
          areas: [{ product: 'core', concern: 'endpoints' }],
          status,
        })
      }),
    )

    const result = await runScan({ decisions, driver: async () => stub.driver })
    const statusOf = (ref: string): string | undefined =>
      result.corpus.docs.find((d) => d.ref === ref)?.status

    expect(statusOf('docs/a.md')).toBe('deferred') // the verdict wins over the header
    expect(statusOf('docs/b.md')).toBe('shipped') // null ⇒ the header parse
    expect(statusOf('docs/c.md')).toBe('shipped') // unrecognized ⇒ the header parse
  })

  // The backstop runs in the FOLD, after the cache — never inside the session.
  // Inside, it would fire only on a fresh verdict and the doc would vanish again
  // on the very next (cached) run.
  it('the alias backstop fires on a CACHED verdict too, with no session', async () => {
    writeDoc(
      'docs/ours.md',
      '# Release notes API\nRelkit publishes a release manifest for every tagged build.\n',
    )
    const decisions = covering(['docs'])
    const drop = () =>
      outcome({
        keep: false,
        reason: 'reads like vendor documentation',
        subject: 'different-product',
        category: 'third-party',
        areas: [{ product: 'core', concern: 'releases' }],
        status: null,
      })

    const first = stubDriver(scanScript(drop))
    expect((await runScan({ decisions, driver: async () => first.driver })).stats.thirdPartyRestored).toBe(1)

    const second = await runScan({
      decisions,
      driver: async () => {
        throw new Error('the cached verdict must not re-session')
      },
    })
    expect(second.stats.thirdPartyRestored).toBe(1)
    expect(second.corpus.docs.map((d) => d.ref)).toContain('docs/ours.md')
  })

  /**
   * The live `corpus_vocab` view must answer with the labels the ASSEMBLY will
   * keep, by the assembly's own rules — otherwise a peer session in flight is
   * steered toward a label belonging to a doc that is about to be dropped. The
   * two halves of the rule are here: a `keep:true` verdict attributed to a
   * DIFFERENT product is a drop (its labels stay out), unless the doc's prose
   * names one of our aliases, in which case the backstop reinstates it at
   * assembly and its labels DO belong in the view.
   */
  it('the live vocab carries a reinstated third-party doc, and not a genuinely foreign one', async () => {
    // `discoverDocs` sorts by path, and the pool runs items in work-list order,
    // so at concurrency 1 these names put both verdicts ahead of the probe.
    writeDoc(
      'docs/a-ours.md',
      '# Publishing\nRelkit publishes a release manifest for every tagged build.\n',
    )
    writeDoc('docs/b-vendor.md', '# ServiceTitan\nServiceTitan dispatches jobs to technicians.\n')
    writeDoc('docs/z-probe.md', '# Errors\nEvery failure carries a code and a message.\n')
    const decisions = covering(['docs'])

    // Both verdicts claim keep:true about a DIFFERENT product — attribution
    // drops them; only the one naming our alias comes back.
    const foreignKeep = (concern: string): unknown => ({
      keep: true,
      reason: 'reads like a real spec',
      subject: 'different-product',
      areas: [{ product: 'core', concern }],
      status: null,
    })

    let vocabSeenByProbe = ''
    const stub = stubDriver(
      scanScript(async (call) => {
        const p = docPathOf(call.briefing)
        if (p === 'docs/a-ours.md') return outcome(foreignKeep('releases'))
        if (p === 'docs/b-vendor.md') return outcome(foreignKeep('dispatch'))
        // The probe reads the live view its peers have folded into.
        const vocab = call.def.tools.find((t) => t.name === 'corpus_vocab')!
        const result = await vocab.execute({}, {
          workItem: p,
          signal: new AbortController().signal,
          dispatchChild: async () => {
            throw new Error('not used')
          },
        })
        vocabSeenByProbe = result.content
        return outcome(KEEP('errors'))
      }),
    )

    // Concurrency 1 so the probe's session runs after both verdicts have folded.
    const result = await runSpecScanSessions({
      repoRoot: repo,
      driver: async () => stub.driver,
      persistence: memoryPersistence().persistence,
      decisions,
      repoIdentity: IDENTITY,
      skipGit: true,
      disableOverlapDetection: true,
      concurrency: 1,
    })

    // The reinstated doc's label is in the live view; the foreign doc's is not.
    expect(vocabSeenByProbe).toContain('releases')
    expect(vocabSeenByProbe).not.toContain('dispatch')
    // …and the view agreed with the assembly it was predicting.
    expect(result.corpus.docs.map((d) => d.ref).sort()).toEqual(['docs/a-ours.md', 'docs/z-probe.md'])
    expect(result.corpus.skippedDocs.map((s) => s.ref)).toEqual(['docs/b-vendor.md'])
    expect(result.stats.thirdPartyDropped).toBe(2)
    expect(result.stats.thirdPartyRestored).toBe(1)
  })

  it('a manual include keeps a doc the session dropped', async () => {
    writeDoc('docs/scratch.md', '# Scratchpad\nRandom thoughts about the ingest pipeline.\n')
    const decisions = covering(['docs'], { manualIncludes: ['docs/scratch.md'] })
    const stub = stubDriver(() =>
      outcome({
        keep: false,
        reason: 'exploratory scratch',
        subject: 'this-product',
        category: 'scratch',
        areas: [{ product: 'core', concern: 'ingest' }],
        status: null,
      }),
    )

    const result = await runScan({ decisions, driver: async () => stub.driver })

    expect(result.corpus.docs.map((d) => d.ref)).toContain('docs/scratch.md')
    expect(result.corpus.skippedDocs.map((s) => s.ref)).not.toContain('docs/scratch.md')
  })
})

// ---------------------------------------------------------------------------
// progress (the "Discovering docs · N/total" line)
// ---------------------------------------------------------------------------

describe('spec-scan.curate-doc — progress', () => {
  it('reports an initial 0/total and then one tick per doc, cache hits included', async () => {
    twoDocs()
    writeDoc('docs/errors.md', '# Errors\nEvery failure carries a code and a message.\n')
    const decisions = covering(['docs'])
    const stub = stubDriver(scanScript(() => outcome(KEEP('endpoints'))))
    const ticks: Array<[number, number]> = []
    const discovered: Array<[number, number]> = []

    await runSpecScanSessions({
      repoRoot: repo,
      driver: async () => stub.driver,
      persistence: memoryPersistence().persistence,
      decisions,
      repoIdentity: IDENTITY,
      skipGit: true,
      disableOverlapDetection: true,
      onDiscover: (docs, toCurate) => discovered.push([docs, toCurate]),
      onCurateProgress: (done, total) => ticks.push([done, total]),
    })

    expect(discovered).toEqual([[3, 3]])
    expect(ticks[0]).toEqual([0, 3])
    expect(ticks).toHaveLength(4)
    expect(ticks[ticks.length - 1]).toEqual([3, 3])
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i][0]).toBeGreaterThanOrEqual(ticks[i - 1][0])
      expect(ticks[i][1]).toBe(3)
    }
  })
})

// ---------------------------------------------------------------------------
// failure: fail-open per doc, abort on systemic loss
// ---------------------------------------------------------------------------

describe('spec-scan.curate-doc — failures', () => {
  it('falls open per doc: the doc is kept untagged and the loss is tallied', async () => {
    twoDocs()
    const decisions = covering(['docs'])
    const stub = stubDriver(
      scanScript(({ briefing }) =>
        docPathOf(briefing).includes('auth')
          ? malformedFailure('no outcome')
          : outcome(KEEP('users entity')),
      ),
    )

    const result = await runScan({ decisions, driver: async () => stub.driver })

    const auth = result.corpus.docs.find((d) => d.ref === 'docs/auth.md')
    expect(auth).toBeDefined()
    expect(auth!.areaTags).toEqual([])
    expect(result.stats.classifyFailed).toBe(1)
    expect(result.stats.llmFailures).toEqual([
      expect.objectContaining({ stage: CURATE_DOC_SESSION_KIND, attempts: 2, failures: 1 }),
    ])
    expect(result.noChanges).toBe(false)
  })

  it('a kind that loses EVERY session to transport aborts before the corpus is written', async () => {
    twoDocs()
    const decisions = covering(['docs'])
    // A sentinel corpus the aborted run must leave byte-identical.
    fs.mkdirSync(path.dirname(corpusFilePath(repo)), { recursive: true })
    fs.writeFileSync(corpusFilePath(repo), '{"sentinel":true}')
    const before = fs.readFileSync(corpusFilePath(repo))

    const stub = stubDriver(() => transportFailure())
    await expect(runScan({ decisions, driver: async () => stub.driver })).rejects.toBeInstanceOf(
      LlmStageFailureError,
    )
    try {
      await runScan({ decisions, driver: async () => stub.driver })
    } catch (e) {
      expect((e as LlmStageFailureError).tally).toMatchObject({
        stage: CURATE_DOC_SESSION_KIND,
        attempts: 2,
        failures: 2,
      })
    }
    expect(fs.readFileSync(corpusFilePath(repo))).toEqual(before)
  })
})

// ---------------------------------------------------------------------------
// through the command adapter
// ---------------------------------------------------------------------------

describe('curateInProcess — the scan command over the session run', () => {
  it('refuses the `agent` mailbox transport, which cannot carry a session', async () => {
    twoDocs()
    await expect(curateInProcess(repo, { llm: 'agent', skipGit: true })).rejects.toThrow(
      /agent.*mailbox transport cannot carry them/i,
    )
  })

  it('a systemic loss closes the run record `failed` and writes no corpus', async () => {
    twoDocs()
    const stub = stubDriver(() => transportFailure())
    await expect(
      curateInProcess(repo, {
        driver: stub.driver,
        decisions: covering(['docs']),
        repoIdentity: IDENTITY,
        skipGit: true,
        disableOverlapDetection: true,
      }),
    ).rejects.toBeInstanceOf(LlmStageFailureError)

    expect(readCorpus(repo)).toBeNull()
    const runsDir = path.join(repo, '.truecourse', 'sessions', 'spec-scan')
    const runIds = fs.readdirSync(runsDir)
    expect(runIds).toHaveLength(1)
    const record = JSON.parse(
      fs.readFileSync(path.join(runsDir, runIds[0], 'run.json'), 'utf-8'),
    ) as { status: string }
    expect(record.status).toBe('failed')
  })

  it('curates the docs into corpus.json through the driver seam', async () => {
    twoDocs()
    const stub = stubDriver(
      scanScript(({ briefing }) =>
        outcome(KEEP(docPathOf(briefing).includes('auth') ? 'auth' : 'users entity')),
      ),
    )
    const { curate, noChanges } = await curateInProcess(repo, {
      driver: stub.driver,
      decisions: covering(['docs']),
      repoIdentity: IDENTITY,
      skipGit: true,
      disableOverlapDetection: true,
    })

    expect(noChanges).toBe(false)
    expect(curate.stats.docsKept).toBe(2)
    expect(readCorpus(repo)!.areas.map((a) => a.id).sort()).toEqual(['core/auth', 'core/users-entity'])
  })
})
