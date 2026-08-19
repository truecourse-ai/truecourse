/**
 * SINGLE-STEP MODE — `runSpecScanSessions({ only })`, the engine behind the
 * CLI's `--only-<step>` flags.
 *
 * The rules under test:
 * - each step runs ONLY its own sessions: prior steps replay from their
 *   durable artifacts (stored scope verdicts, outcome caches), later steps
 *   never start;
 * - a prior step's cache MISS fails loud (`ScanStepNotReadyError`, naming the
 *   step to run first) instead of silently spending its sessions — a silent
 *   re-run would mask exactly the cache-key drift stepwise runs exist to expose;
 * - corpus.json is written only by the final step (`overlap`); every earlier
 *   stop returns `stoppedAfter` and touches no corpus;
 * - the stepwise chain (curate → settle → overlap) reaches the same corpus a
 *   whole scan writes, each leg served from the previous leg's cache.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resetKvCacheStore } from '@truecourse/llm'
import {
  ScanStepNotReadyError,
  runSpecScanSessions,
} from '../../packages/core/src/services/spec-scan/run'
import { SPEC_SCAN_ORCHESTRATE_SESSION_KIND } from '../../packages/core/src/services/spec-scan/orchestrate'
import { CURATE_DOC_SESSION_KIND } from '../../packages/core/src/services/spec-scan/curate-doc'
import { SETTLE_AREAS_SESSION_KIND } from '../../packages/core/src/services/spec-scan/settle-areas'
import { OVERLAP_SESSION_KIND } from '../../packages/core/src/services/spec-scan/overlap'
import { readDecisions, writeDecisions, type DecisionsFile } from '../../packages/spec-consolidator/src/index.js'
import {
  docPathOf,
  forbiddenDriver,
  memoryPersistence,
  outcome,
  stubDriver,
  toolResult,
  type StubCall,
} from './spec-scan-session-stub'
import type { DriverResult } from '../../packages/agent-loop/src/index'

// ---------------------------------------------------------------------------
// fixture
// ---------------------------------------------------------------------------

let repo: string
beforeEach(() => {
  resetKvCacheStore()
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-scan-steps-'))
  writeDocs({
    'docs/a.md': '# A\n\nBooking rules.\n',
    'docs/b.md': '# B\n\nScheduling rules.\n',
  })
})
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true })
})

function writeDocs(files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(repo, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }
}

function seedDecisions(over: Partial<DecisionsFile> = {}): void {
  writeDecisions(repo, {
    version: 2,
    manualIncludes: [],
    manualExcludes: [],
    manualAreas: [],
    conflictResolutions: [],
    scopeVerdicts: [],
    instructions: [],
    ...over,
  })
}

const corpusFile = (): string => path.join(repo, '.truecourse', 'specs', 'corpus.json')

/** Curate verdicts with TWO concerns, so the settle gate opens (≥2 on an axis). */
async function curateByPath(call: StubCall): Promise<DriverResult> {
  const concern = docPathOf(call.briefing).endsWith('a.md') ? 'booking' : 'scheduling'
  return outcome({ keep: true, reason: 'spec source', areas: [{ product: 'core', concern }] })
}

const EMPTY_SETTLEMENT = { concernMerges: {}, productMerges: {}, productVerdicts: [], subdivisions: [] }

/** The full chain's script: every kind answered, preconditions satisfied. */
async function anyKind(call: StubCall): Promise<DriverResult> {
  switch (call.kind) {
    case CURATE_DOC_SESSION_KIND:
      return curateByPath(call)
    case SETTLE_AREAS_SESSION_KIND:
      await call.emit(toolResult('check_settlement', 'valid'))
      return outcome(EMPTY_SETTLEMENT)
    case OVERLAP_SESSION_KIND:
      await call.emit(toolResult('check_findings', 'The draft is valid.'))
      return outcome({ overlaps: [], notReached: [] })
    default:
      throw new Error(`unscripted session kind: ${call.kind}`)
  }
}

async function runOnly(
  only: 'orchestrate' | 'curate' | 'settle' | 'overlap',
  script: (call: StubCall) => DriverResult | Promise<DriverResult>,
) {
  const stub = stubDriver(script)
  const result = await runSpecScanSessions({
    repoRoot: repo,
    driver: async () => stub.driver,
    persistence: memoryPersistence().persistence,
    skipGit: true,
    only,
  })
  return { result, kinds: stub.kinds }
}

// ---------------------------------------------------------------------------
// --only-orchestrate
// ---------------------------------------------------------------------------

describe('--only-orchestrate', () => {
  it('runs the scope session, persists its verdicts, and stops before curation', async () => {
    seedDecisions()
    const { result, kinds } = await runOnly('orchestrate', async (call) => {
      if (call.kind !== SPEC_SCAN_ORCHESTRATE_SESSION_KIND) {
        throw new Error(`only the scope session may run, saw ${call.kind}`)
      }
      return outcome({
        scopeVerdicts: [{ path: 'docs', verdict: 'keep', reason: 'our specs' }],
        instructions: [],
      })
    })
    expect(kinds).toEqual([SPEC_SCAN_ORCHESTRATE_SESSION_KIND])
    expect(result.stoppedAfter).toBe('orchestrate')
    expect(result.noChanges).toBe(false)
    expect(result.sessions.map((s) => s.kind)).toEqual([SPEC_SCAN_ORCHESTRATE_SESSION_KIND])
    // The step's durable artifact landed…
    expect(readDecisions(repo).scopeVerdicts).toHaveLength(1)
    // …and the corpus was never touched.
    expect(fs.existsSync(corpusFile())).toBe(false)
  })

  it('spends nothing on a covered universe — the pre-pass IS the step', async () => {
    seedDecisions({
      scopeVerdicts: [
        { path: '.', verdict: 'keep', reason: 'root', decidedAt: 'now', resolvedBy: 'user' },
        { path: 'docs', verdict: 'keep', reason: 'specs', decidedAt: 'now', resolvedBy: 'user' },
      ],
    })
    const result = await runSpecScanSessions({
      repoRoot: repo,
      driver: async () => forbiddenDriver(),
      persistence: memoryPersistence().persistence,
      skipGit: true,
      only: 'orchestrate',
    })
    expect(result.stoppedAfter).toBe('orchestrate')
    expect(result.noChanges).toBe(true)
    expect(result.sessions).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// --only-curate
// ---------------------------------------------------------------------------

describe('--only-curate', () => {
  it('never starts a scope session even on an UNCOVERED universe, curates, and stops', async () => {
    seedDecisions()
    const { result, kinds } = await runOnly('curate', async (call) => {
      if (call.kind === SPEC_SCAN_ORCHESTRATE_SESSION_KIND) {
        throw new Error('the scope session belongs to --only-orchestrate')
      }
      return curateByPath(call)
    })
    expect(kinds).toEqual([CURATE_DOC_SESSION_KIND, CURATE_DOC_SESSION_KIND])
    expect(result.stoppedAfter).toBe('curate')
    expect(result.stats.docsKept).toBe(2)
    expect(fs.existsSync(corpusFile())).toBe(false)

    // A warm re-run of the same step spends nothing.
    const again = await runSpecScanSessions({
      repoRoot: repo,
      driver: async () => forbiddenDriver(),
      persistence: memoryPersistence().persistence,
      skipGit: true,
      only: 'curate',
    })
    expect(again.noChanges).toBe(true)
    expect(again.sessions.find((s) => s.kind === CURATE_DOC_SESSION_KIND)?.fromCache).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// a prior step's missing cache fails LOUD
// ---------------------------------------------------------------------------

describe('a prior step not yet run', () => {
  it('--only-settle on a cold curation cache throws, naming the step and the misses', async () => {
    seedDecisions()
    const error = await runSpecScanSessions({
      repoRoot: repo,
      driver: async () => forbiddenDriver('a cache-only replay must not spend sessions'),
      persistence: memoryPersistence().persistence,
      skipGit: true,
      only: 'settle',
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ScanStepNotReadyError)
    expect((error as ScanStepNotReadyError).step).toBe('curate')
    expect((error as ScanStepNotReadyError).missing).toHaveLength(2)
    expect((error as ScanStepNotReadyError).message).toContain('--only-curate')
  })

  it('--only-overlap after curation but before settling throws for the settle step', async () => {
    seedDecisions()
    await runOnly('curate', anyKind)
    const error = await runSpecScanSessions({
      repoRoot: repo,
      driver: async () => forbiddenDriver('a cache-only replay must not spend sessions'),
      persistence: memoryPersistence().persistence,
      skipGit: true,
      only: 'overlap',
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ScanStepNotReadyError)
    expect((error as ScanStepNotReadyError).step).toBe('settle')
    expect(fs.existsSync(corpusFile())).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// the chain: curate → settle → overlap reaches a written corpus
// ---------------------------------------------------------------------------

describe('the stepwise chain', () => {
  it('each leg replays the previous from cache, and only the last writes corpus.json', async () => {
    seedDecisions()

    const curateLeg = await runOnly('curate', anyKind)
    expect(curateLeg.kinds).toEqual([CURATE_DOC_SESSION_KIND, CURATE_DOC_SESSION_KIND])

    const settleLeg = await runOnly('settle', async (call) => {
      if (call.kind !== SETTLE_AREAS_SESSION_KIND) {
        throw new Error(`only the settle session may run, saw ${call.kind}`)
      }
      return anyKind(call)
    })
    expect(settleLeg.kinds).toEqual([SETTLE_AREAS_SESSION_KIND])
    expect(settleLeg.result.stoppedAfter).toBe('settle')
    expect(settleLeg.result.stats.areaCount).toBe(2)
    expect(settleLeg.result.sessions.find((s) => s.kind === CURATE_DOC_SESSION_KIND)?.fromCache).toBe(2)
    expect(fs.existsSync(corpusFile())).toBe(false)

    // The final step completes the scan: earlier steps from cache, corpus written.
    const overlapLeg = await runOnly('overlap', async (call) => {
      if (call.kind === CURATE_DOC_SESSION_KIND || call.kind === SETTLE_AREAS_SESSION_KIND) {
        throw new Error(`${call.kind} must replay from cache in --only-overlap`)
      }
      return anyKind(call)
    })
    expect(overlapLeg.result.stoppedAfter).toBeUndefined()
    expect(fs.existsSync(corpusFile())).toBe(true)
    expect(overlapLeg.result.corpus.docs.map((d) => d.ref).sort()).toEqual(['docs/a.md', 'docs/b.md'])
    expect(overlapLeg.result.corpus.areas).toHaveLength(2)
  })
})
