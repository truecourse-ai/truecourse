/**
 * THE SCAN ORCHESTRATOR SESSION — `spec-scan.orchestrate` (plan 02 step 6),
 * plus the decisions schema v2 it writes into.
 *
 * The rules under test:
 * - a COVERED universe spends ZERO sessions (the deterministic pre-pass);
 * - an uncovered one spends exactly one, and its `exclude` verdicts drop
 *   subtrees BEFORE any discovery-cost stage — no curate-doc session is ever
 *   created for an excluded doc, and the corpus does not even list it as skipped;
 * - the fold stamps `resolvedBy: 'auto'` + `decidedAt` and NEVER overwrites a
 *   user row (it does replace an earlier auto row);
 * - `instructions` ride every downstream briefing AND every downstream cache
 *   key, so adding one re-scans the corpus;
 * - a v1 decisions.json still parses; every write stamps version 2;
 * - the session is interactive: an unanswered question never blocks a
 *   non-interactive run, it lands on `pendingQuestions`;
 * - one-abort applies to this kind too (transport), while a malformed loss
 *   fails open onto the stored verdicts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resetKvCacheStore } from '@truecourse/llm'
import { runSpecScanSessions } from '../../packages/core/src/services/spec-scan/run'
import {
  SPEC_SCAN_ORCHESTRATE_SESSION_KIND,
  applyScopeVerdicts,
  buildScanScopeUniverse,
  mergeScopeOutcome,
  normalizeScopePath,
  orchestrateSessionDef,
  scopeCoverage,
} from '../../packages/core/src/services/spec-scan/orchestrate'
import { buildScanUniverse } from '../../packages/core/src/services/spec-scan/tools'
import { CURATE_DOC_SESSION_KIND } from '../../packages/core/src/services/spec-scan/curate-doc'
import { SETTLE_AREAS_SESSION_KIND } from '../../packages/core/src/services/spec-scan/settle-areas'
import { OVERLAP_SESSION_KIND } from '../../packages/core/src/services/spec-scan/overlap'
import { curateInProcess, syncWorkspaceCorpusInProcess } from '../../packages/core/src/commands/spec-in-process'
import {
  DecisionsFileSchema,
  decisionsPath,
  readDecisions,
  writeDecisions,
  writeSourcesFile,
  type DecisionsFile,
  type DocCandidate,
  type ScopeVerdict,
} from '../../packages/spec-consolidator/src/index.js'
import { LlmStageFailureError } from '@truecourse/shared/llm'
import type {
  DriverResult,
  SessionDriver,
  SessionEvent,
  SessionIndexEntry,
  SessionPersistence,
  SessionRunInput,
  UserInputQuestion,
} from '../../packages/agent-loop/src/index'

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

function openingOf(input: SessionRunInput): string {
  const last = input.initialMessages.at(-1)
  if (last !== undefined) return last
  for (const event of [...(input.resume?.events ?? [])].reverse()) {
    if (event.type === 'user-message') return event.content
  }
  return ''
}

interface Seen {
  kind: string
  briefing: string
}

type Script = (kind: string, input: SessionRunInput) => Promise<DriverResult>

function scriptedDriver(script: Script): { driver: SessionDriver; seen: Seen[] } {
  const seen: Seen[] = []
  const driver: SessionDriver = {
    capabilities: { steering: 'turn-boundary', structuredOutcome: 'tool', resumeAtMessage: false },
    attribution: { provider: 'test', model: 'scripted' },
    runSession(input) {
      seen.push({ kind: input.def.kind, briefing: openingOf(input) })
      let ranCheck = false
      const observed: SessionRunInput = {
        ...input,
        onEvent: (event) => {
          if (event.type === 'tool-result' && event.toolName === 'check_findings') ranCheck = true
          input.onEvent(event)
        },
      }
      for (const content of input.initialMessages) input.onEvent({ type: 'user-message', content })
      const done = (async () => {
        await new Promise((r) => setTimeout(r, 0))
        const result = await script(input.def.kind, observed)
        // The overlap def carries an `outcomePrecondition` on `check_findings`;
        // a script standing in for a model that followed its prompt has run it.
        if (result.kind === 'outcome' && input.def.kind === OVERLAP_SESSION_KIND && !ranCheck) {
          input.onEvent({
            type: 'tool-result',
            toolName: 'check_findings',
            content: 'The draft is valid.',
            isError: false,
          })
        }
        return result
      })()
      return { done, status: () => 'running' as const, steer: () => {}, interrupt: async () => {} }
    },
  }
  return { driver, seen }
}

function memoryPersistence(): SessionPersistence {
  const events = new Map<string, SessionEvent[]>()
  const index = new Map<string, SessionIndexEntry>()
  return {
    appendEvent(sessionId, event) {
      const list = events.get(sessionId) ?? []
      list.push(event)
      events.set(sessionId, list)
    },
    updateIndex(entry) {
      index.set(entry.sessionId, entry)
    },
    readEvents(sessionId) {
      return events.get(sessionId) ?? []
    },
  }
}

const KEEP_DOC: DriverResult = {
  kind: 'outcome',
  value: { keep: true, reason: 'spec source', areas: [{ product: 'core', concern: 'misc' }] },
}
const EMPTY_SETTLEMENT: DriverResult = {
  kind: 'outcome',
  value: { concernMerges: {}, productMerges: {}, productVerdicts: [], subdivisions: [] },
}
const NO_OVERLAPS: DriverResult = { kind: 'outcome', value: { overlaps: [], notReached: [] } }

/** Answer every downstream kind trivially; `orchestrate` is the caller's job. */
function downstream(orchestrate: (input: SessionRunInput) => Promise<DriverResult>): Script {
  return async (kind, input) => {
    if (kind === SPEC_SCAN_ORCHESTRATE_SESSION_KIND) return orchestrate(input)
    if (kind === CURATE_DOC_SESSION_KIND) return KEEP_DOC
    if (kind === SETTLE_AREAS_SESSION_KIND) return EMPTY_SETTLEMENT
    if (kind === OVERLAP_SESSION_KIND) return NO_OVERLAPS
    throw new Error(`unscripted session kind: ${kind}`)
  }
}

const NO_ORCHESTRATE = async (): Promise<DriverResult> => {
  throw new Error('an orchestrate session must not start')
}

// ---------------------------------------------------------------------------
// fixture
// ---------------------------------------------------------------------------

let repo: string
beforeEach(() => {
  resetKvCacheStore()
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-scan-scope-'))
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

const verdict = (over: Partial<ScopeVerdict> & Pick<ScopeVerdict, 'path' | 'verdict'>): ScopeVerdict => ({
  reason: 'because',
  decidedAt: '2026-01-01T00:00:00Z',
  ...over,
})

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

const docCandidate = (p: string): DocCandidate => ({
  path: p,
  absPath: `/abs/${p}`,
  content: `# ${p}\n`,
  kind: 'prd',
  preview: `# ${p}`,
  lastTouched: '2026-01-01T00:00:00Z',
  contentHash: `hash-${p}`,
  size: 10,
})

// ---------------------------------------------------------------------------
// 1. decisions schema v2 — v1 in, v2 out
// ---------------------------------------------------------------------------

describe('decisions schema v2', () => {
  it('parses a v1 file, defaults the new fields, and drops a legacy `relations` array', () => {
    fs.mkdirSync(path.dirname(decisionsPath(repo)), { recursive: true })
    fs.writeFileSync(
      decisionsPath(repo),
      JSON.stringify({
        version: 1,
        manualIncludes: ['docs/keep.md'],
        relations: [{ from: 'a.md', to: 'b.md', kind: 'replace' }],
      }),
    )
    const parsed = readDecisions(repo)
    expect(parsed.version).toBe(1)
    expect(parsed.manualIncludes).toEqual(['docs/keep.md'])
    expect(parsed.scopeVerdicts).toEqual([])
    expect(parsed.instructions).toEqual([])
    expect(parsed).not.toHaveProperty('relations')
  })

  it('parses a v2 file with the new rows', () => {
    const parsed = DecisionsFileSchema.parse({
      version: 2,
      scopeVerdicts: [{ path: 'docs', verdict: 'keep', reason: 'r', decidedAt: 'now', resolvedBy: 'auto' }],
      instructions: ['docs/handbook is process, not product'],
    })
    expect(parsed.scopeVerdicts).toHaveLength(1)
    expect(parsed.instructions).toEqual(['docs/handbook is process, not product'])
  })

  it('always writes version 2, whatever the caller still carries', () => {
    writeDecisions(repo, {
      version: 1,
      manualIncludes: [],
      manualExcludes: [],
      manualAreas: [],
      conflictResolutions: [],
      scopeVerdicts: [verdict({ path: 'docs', verdict: 'keep' })],
      instructions: ['keep this'],
    })
    const raw = JSON.parse(fs.readFileSync(decisionsPath(repo), 'utf-8'))
    expect(raw.version).toBe(2)
    expect(raw.scopeVerdicts).toHaveLength(1)
    expect(raw.instructions).toEqual(['keep this'])
  })
})

// ---------------------------------------------------------------------------
// 2/3. coverage: zero sessions when covered, one when not
// ---------------------------------------------------------------------------

describe('the deterministic coverage pre-pass', () => {
  it('spends ZERO orchestrate sessions on a fully covered universe', async () => {
    writeDocs({ 'docs/a.md': '# A\n', 'README.md': '# Root\n' })
    seedDecisions({
      scopeVerdicts: [
        verdict({ path: '.', verdict: 'keep' }),
        verdict({ path: 'docs', verdict: 'keep' }),
      ],
    })
    const states: string[] = []
    const { driver, seen } = scriptedDriver(downstream(NO_ORCHESTRATE))
    const result = await runSpecScanSessions({
      repoRoot: repo,
      driver: async () => driver,
      persistence: memoryPersistence(),
      skipGit: true,
      onScope: (state) => states.push(state),
    })
    expect(states).toEqual(['covered'])
    expect(seen.some((s) => s.kind === SPEC_SCAN_ORCHESTRATE_SESSION_KIND)).toBe(false)
    expect(result.sessions.some((s) => s.kind === SPEC_SCAN_ORCHESTRATE_SESSION_KIND)).toBe(false)
  })

  it('spends ONE session on an uncovered universe and applies its verdicts before any cost', async () => {
    writeDocs({ 'docs/keep/a.md': '# A\n', 'vendor/dropme/b.md': '# B\n' })
    seedDecisions()
    const states: string[] = []
    const { driver, seen } = scriptedDriver(
      downstream(async () => ({
        kind: 'outcome',
        value: {
          scopeVerdicts: [
            { path: 'docs', verdict: 'keep', reason: 'our specs' },
            { path: 'vendor', verdict: 'exclude', reason: 'vendored mirror' },
          ],
          instructions: [],
        },
      })),
    )
    const result = await runSpecScanSessions({
      repoRoot: repo,
      driver: async () => driver,
      persistence: memoryPersistence(),
      skipGit: true,
      now: () => '2026-08-19T00:00:00.000Z',
      onScope: (state) => states.push(state),
    })

    expect(states).toEqual(['ran'])
    // (i) the rows are stored, stamped auto + with the injected clock
    const stored = readDecisions(repo)
    expect(stored.scopeVerdicts).toEqual([
      { path: 'docs', verdict: 'keep', reason: 'our specs', decidedAt: '2026-08-19T00:00:00.000Z', resolvedBy: 'auto' },
      {
        path: 'vendor',
        verdict: 'exclude',
        reason: 'vendored mirror',
        decidedAt: '2026-08-19T00:00:00.000Z',
        resolvedBy: 'auto',
      },
    ])
    // (ii) the excluded subtree never reached a curate-doc session
    const curated = seen.filter((s) => s.kind === CURATE_DOC_SESSION_KIND).map((s) => /PATH \(repo-relative\): (.+)/.exec(s.briefing)?.[1])
    expect(curated).toEqual(['docs/keep/a.md'])
    // (iii) …and it is not in the corpus, not even as a skipped doc
    expect(result.corpus.docs.map((d) => d.ref)).toEqual(['docs/keep/a.md'])
    expect(result.corpus.skippedDocs.map((s) => s.ref)).not.toContain('vendor/dropme/b.md')
    expect(result.stats.docsScanned).toBe(1)
  })

  it('re-opens the session when the universe GROWS into an unverdicted corner', async () => {
    writeDocs({ 'docs/a.md': '# A\n' })
    seedDecisions({ scopeVerdicts: [verdict({ path: 'docs', verdict: 'keep' })] })
    const covered = scopeCoverage(
      buildScanScopeUniverse(buildScanUniverse([docCandidate('docs/a.md')]), []),
      readDecisions(repo).scopeVerdicts,
    )
    expect(covered.covered).toBe(true)

    const grown = scopeCoverage(
      buildScanScopeUniverse(
        buildScanUniverse([docCandidate('docs/a.md'), docCandidate('handbook/onboarding.md')]),
        [],
      ),
      readDecisions(repo).scopeVerdicts,
    )
    expect(grown.covered).toBe(false)
    expect(grown.uncoveredDirs).toEqual([{ path: 'handbook', docs: 1 }])
  })
})

// ---------------------------------------------------------------------------
// 4. the fold: user rows are authoritative
// ---------------------------------------------------------------------------

describe('mergeScopeOutcome', () => {
  const base = (rows: ScopeVerdict[]): DecisionsFile => ({
    version: 2,
    manualIncludes: [],
    manualExcludes: [],
    manualAreas: [],
    conflictResolutions: [],
    scopeVerdicts: rows,
    instructions: [],
  })

  it('never overwrites a USER row', () => {
    const merged = mergeScopeOutcome(
      base([verdict({ path: 'docs', verdict: 'exclude', reason: 'mine', resolvedBy: 'user' })]),
      { scopeVerdicts: [{ path: 'docs', verdict: 'keep', reason: 'session says keep' }], instructions: [] },
      'now',
    )
    expect(merged.scopeVerdicts).toEqual([
      { path: 'docs', verdict: 'exclude', reason: 'mine', decidedAt: '2026-01-01T00:00:00Z', resolvedBy: 'user' },
    ])
  })

  it('DOES replace an earlier auto row for the same path', () => {
    const merged = mergeScopeOutcome(
      base([verdict({ path: 'docs', verdict: 'exclude', reason: 'stale', resolvedBy: 'auto' })]),
      { scopeVerdicts: [{ path: 'docs', verdict: 'keep', reason: 'revised' }], instructions: [] },
      'now',
    )
    expect(merged.scopeVerdicts).toEqual([
      { path: 'docs', verdict: 'keep', reason: 'revised', decidedAt: 'now', resolvedBy: 'auto' },
    ])
  })

  it('normalizes trailing slashes so `docs/` and `docs` are one row', () => {
    const merged = mergeScopeOutcome(
      base([verdict({ path: 'docs', verdict: 'keep', resolvedBy: 'auto' })]),
      { scopeVerdicts: [{ path: 'docs/', verdict: 'exclude', reason: 'r' }], instructions: [] },
      'now',
    )
    expect(merged.scopeVerdicts).toHaveLength(1)
    expect(merged.scopeVerdicts[0]).toMatchObject({ path: 'docs', verdict: 'exclude' })
    expect(normalizeScopePath('docs/')).toBe('docs')
  })

  it('append-merges instructions without duplicating', () => {
    const merged = mergeScopeOutcome(
      { ...base([]), instructions: ['first'] },
      { scopeVerdicts: [], instructions: ['first', 'second'] },
      'now',
    )
    expect(merged.instructions).toEqual(['first', 'second'])
  })

  it('the run persists the merged rows and leaves a user exclude standing', async () => {
    writeDocs({ 'docs/a.md': '# A\n', 'handbook/b.md': '# B\n' })
    seedDecisions({
      scopeVerdicts: [verdict({ path: 'docs', verdict: 'exclude', reason: 'mine', resolvedBy: 'user' })],
    })
    const { driver } = scriptedDriver(
      downstream(async () => ({
        kind: 'outcome',
        value: {
          scopeVerdicts: [
            { path: 'docs', verdict: 'keep', reason: 'session disagrees' },
            { path: 'handbook', verdict: 'keep', reason: 'process specs' },
          ],
          instructions: [],
        },
      })),
    )
    const result = await runSpecScanSessions({
      repoRoot: repo,
      driver: async () => driver,
      persistence: memoryPersistence(),
      skipGit: true,
    })
    const stored = readDecisions(repo)
    expect(stored.scopeVerdicts.find((v) => v.path === 'docs')).toMatchObject({
      verdict: 'exclude',
      resolvedBy: 'user',
    })
    // …and the user's exclude is what the run actually scanned by.
    expect(result.corpus.docs.map((d) => d.ref)).toEqual(['handbook/b.md'])
  })
})

// ---------------------------------------------------------------------------
// verdict application — the path forms
// ---------------------------------------------------------------------------

describe('applyScopeVerdicts', () => {
  const docs = [
    docCandidate('README.md'),
    docCandidate('docs/a.md'),
    docCandidate('docs/archive/old.md'),
    docCandidate('.truecourse/specs/sources/acme/index.md'),
  ]
  const sources = [{ id: 'acme', title: 'Acme', pages: 1 }]

  it('`.` covers ROOT files only', () => {
    const kept = applyScopeVerdicts(docs, [verdict({ path: '.', verdict: 'exclude' })], sources)
    expect(kept.map((d) => d.path)).toEqual([
      'docs/a.md',
      'docs/archive/old.md',
      '.truecourse/specs/sources/acme/index.md',
    ])
  })

  it('the MOST SPECIFIC verdict wins (docs keep + docs/archive exclude)', () => {
    const kept = applyScopeVerdicts(
      docs,
      [verdict({ path: 'docs', verdict: 'keep' }), verdict({ path: 'docs/archive', verdict: 'exclude' })],
      sources,
    )
    expect(kept.map((d) => d.path)).not.toContain('docs/archive/old.md')
    expect(kept.map((d) => d.path)).toContain('docs/a.md')
  })

  it('a SOURCE ID verdict covers that source\'s snapshots', () => {
    const kept = applyScopeVerdicts(docs, [verdict({ path: 'acme', verdict: 'exclude' })], sources)
    expect(kept.map((d) => d.path)).not.toContain('.truecourse/specs/sources/acme/index.md')
    expect(kept).toHaveLength(3)
  })

  it('keeps an uncovered doc — exclusion is explicit, never a default', () => {
    expect(applyScopeVerdicts(docs, [verdict({ path: 'docs', verdict: 'keep' })], sources)).toHaveLength(4)
  })

  it('a trailing slash is the same path', () => {
    const kept = applyScopeVerdicts(docs, [verdict({ path: 'docs/', verdict: 'exclude' })], sources)
    expect(kept.map((d) => d.path)).toEqual(['README.md', '.truecourse/specs/sources/acme/index.md'])
  })
})

describe('a registered source', () => {
  it('is uncovered until a verdict names it, and an exclude drops its snapshots from the scan', async () => {
    writeDocs({
      'docs/a.md': '# A\n',
      '.truecourse/specs/sources/acme/index.md': '# Acme index\n',
    })
    writeSourcesFile(repo, {
      version: 1,
      sources: [
        {
          id: 'acme',
          llmsTxtUrl: 'https://acme.example/llms.txt',
          title: 'Acme',
          fetchedAt: '2026-01-01T00:00:00Z',
          docs: [{ url: 'https://acme.example/index', path: 'index.md', title: 'Index', contentHash: 'h' }],
          skipped: [],
        },
      ],
    })
    // A verdict over `docs` alone leaves the SOURCE uncovered.
    seedDecisions({ scopeVerdicts: [verdict({ path: 'docs', verdict: 'keep' })] })

    const { driver, seen } = scriptedDriver(
      downstream(async (input) => {
        expect(openingOf(input)).toContain('source: acme')
        return {
          kind: 'outcome',
          value: {
            scopeVerdicts: [{ path: 'acme', verdict: 'exclude', reason: 'vendored docs mirror' }],
            instructions: [],
          },
        }
      }),
    )
    const result = await runSpecScanSessions({
      repoRoot: repo,
      driver: async () => driver,
      persistence: memoryPersistence(),
      skipGit: true,
    })
    expect(seen.filter((s) => s.kind === SPEC_SCAN_ORCHESTRATE_SESSION_KIND)).toHaveLength(1)
    expect(result.corpus.docs.map((d) => d.ref)).toEqual(['docs/a.md'])
  })
})

// ---------------------------------------------------------------------------
// 5. instructions re-key everything downstream
// ---------------------------------------------------------------------------

describe('standing instructions', () => {
  const INSTRUCTION = 'docs under handbook/ describe company process, not product behavior'

  it('ride every downstream briefing and re-key every downstream cache entry', async () => {
    writeDocs({ 'docs/a.md': '# A\n\n## Auth\n\nx\n', 'docs/b.md': '# B\n\n## Auth\n\ny\n' })
    seedDecisions({ scopeVerdicts: [verdict({ path: 'docs', verdict: 'keep' })] })

    const cold = scriptedDriver(downstream(NO_ORCHESTRATE))
    await runSpecScanSessions({
      repoRoot: repo,
      driver: async () => cold.driver,
      persistence: memoryPersistence(),
      skipGit: true,
    })
    const coldKinds = cold.seen.map((s) => s.kind)
    expect(coldKinds.filter((k) => k === CURATE_DOC_SESSION_KIND)).toHaveLength(2)
    expect(coldKinds).toContain(OVERLAP_SESSION_KIND)
    for (const s of cold.seen) expect(s.briefing).not.toContain('STANDING SCAN INSTRUCTIONS')

    // A warm re-run spends nothing…
    const warm = scriptedDriver(downstream(NO_ORCHESTRATE))
    const unchanged = await runSpecScanSessions({
      repoRoot: repo,
      driver: async () => warm.driver,
      persistence: memoryPersistence(),
      skipGit: true,
    })
    expect(unchanged.noChanges).toBe(true)
    expect(warm.seen).toEqual([])

    // …until one instruction is added, which re-keys EVERY kind.
    const stored = readDecisions(repo)
    writeDecisions(repo, { ...stored, instructions: [INSTRUCTION] })
    const rekeyed = scriptedDriver(downstream(NO_ORCHESTRATE))
    await runSpecScanSessions({
      repoRoot: repo,
      driver: async () => rekeyed.driver,
      persistence: memoryPersistence(),
      skipGit: true,
    })
    expect(rekeyed.seen.map((s) => s.kind).sort()).toEqual(coldKinds.sort())
    for (const s of rekeyed.seen) {
      expect(s.briefing).toContain('STANDING SCAN INSTRUCTIONS')
      expect(s.briefing).toContain(INSTRUCTION)
    }
  })
})

// ---------------------------------------------------------------------------
// 6. questions never block a non-interactive run
// ---------------------------------------------------------------------------

describe('the interactive session', () => {
  it('is declared interactive', () => {
    const scope = buildScanScopeUniverse(buildScanUniverse([docCandidate('docs/a.md')]), [])
    expect(orchestrateSessionDef(scope).interactive).toBe(true)
  })

  it('surfaces an unanswered question on the result instead of blocking', async () => {
    writeDocs({ 'docs/a.md': '# A\n' })
    seedDecisions()
    const question: UserInputQuestion = {
      id: 'q1',
      header: 'Scan scope',
      question: 'Is `docs/` product documentation or the company handbook?',
      options: [{ label: 'product docs' }, { label: 'handbook' }],
      multiSelect: false,
    }
    const { driver } = scriptedDriver(
      downstream(async (input) => {
        input.onEvent({ type: 'question-asked', question })
        return {
          kind: 'outcome',
          value: {
            scopeVerdicts: [{ path: 'docs', verdict: 'keep', reason: 'assumed product docs' }],
            instructions: [],
          },
        }
      }),
    )
    const seenQuestions: Array<{ workItem: string; id: string }> = []
    const { curate, pendingQuestions } = await curateInProcess(repo, {
      driver,
      skipGit: true,
      onQuestion: (workItem, q) => seenQuestions.push({ workItem, id: q.id }),
    })
    expect(pendingQuestions.map((q) => q.id)).toEqual(['q1'])
    expect(seenQuestions).toEqual([{ workItem: 'scan-scope', id: 'q1' }])
    expect(curate.corpus.docs.map((d) => d.ref)).toEqual(['docs/a.md'])
  })
})

// ---------------------------------------------------------------------------
// 7/8. failure shapes and the surfaces that opt out
// ---------------------------------------------------------------------------

describe('a failed orchestrate session', () => {
  beforeEach(() => {
    writeDocs({ 'docs/a.md': '# A\n' })
    seedDecisions()
  })

  it('aborts the run before any corpus write when it dies of transport', async () => {
    const corpusFile = path.join(repo, '.truecourse', 'specs', 'corpus.json')
    fs.mkdirSync(path.dirname(corpusFile), { recursive: true })
    const sentinel = JSON.stringify({ version: 3, generatedAt: 'never', docs: [], areas: [], skippedDocs: [] })
    fs.writeFileSync(corpusFile, sentinel)

    const { driver } = scriptedDriver(
      downstream(async () => ({
        kind: 'failure',
        failure: { kind: 'transport', detail: 'provider down', class: 'provider', retryability: 'none' },
      })),
    )
    const error = await runSpecScanSessions({
      repoRoot: repo,
      driver: async () => driver,
      persistence: memoryPersistence(),
      skipGit: true,
    }).catch((e: unknown) => e as LlmStageFailureError)
    expect(error).toBeInstanceOf(LlmStageFailureError)
    expect((error as LlmStageFailureError).tally.stage).toBe(SPEC_SCAN_ORCHESTRATE_SESSION_KIND)
    expect(fs.readFileSync(corpusFile, 'utf-8')).toBe(sentinel)
  })

  it('fails OPEN on a malformed loss — the scan proceeds on the stored verdicts and tallies', async () => {
    const states: string[] = []
    const { driver } = scriptedDriver(
      downstream(async () => ({
        kind: 'failure',
        failure: { kind: 'malformed', detail: 'not an object', retryability: 'none' },
      })),
    )
    const result = await runSpecScanSessions({
      repoRoot: repo,
      driver: async () => driver,
      persistence: memoryPersistence(),
      skipGit: true,
      onScope: (state) => states.push(state),
    })
    expect(states).toEqual(['failed'])
    expect(result.corpus.docs.map((d) => d.ref)).toEqual(['docs/a.md'])
    expect(result.stats.llmFailures).toContainEqual(
      expect.objectContaining({ stage: SPEC_SCAN_ORCHESTRATE_SESSION_KIND, attempts: 1, failures: 1 }),
    )
    // Nothing was settled, so nothing was written into decisions.json.
    expect(readDecisions(repo).scopeVerdicts).toEqual([])
  })
})

describe('surfaces that skip the scope session', () => {
  /**
   * The workspace sync's scratch tree is transient, so a scope session there
   * would re-spend every sync and settle nothing durable. It cannot be run to
   * completion in OSS (persisting a workspace corpus needs the EE spec store —
   * `tests/ee-server/knowledge-workspace-corpus.test.ts` owns that path), but
   * the part that matters is reachable: the curation runs to the PERSIST step
   * on a driver that throws the moment an orchestrate session starts.
   */
  it('an injected doc source (workspace sync) never starts one', async () => {
    const error = await syncWorkspaceCorpusInProcess({
      workspaceOrgId: 'acme',
      docs: [{ docPath: 'knowledge/confluence/a.md', markdown: '# A\n\nSome spec prose.\n' }],
      driver: scriptedDriver(downstream(NO_ORCHESTRATE)).driver,
    }).catch((e: unknown) => e as Error)
    expect(error).toBeInstanceOf(Error)
    // It got as far as persisting — i.e. the scan itself completed — and the
    // failure is the OSS store's workspace refusal, never a scope session.
    expect((error as Error).message).toContain('workspace-scoped specs require the enterprise store')
  })

  it('`disableScopeOrchestration` honors the stored verdicts without a session', async () => {
    writeDocs({ 'docs/a.md': '# A\n', 'vendor/b.md': '# B\n' })
    seedDecisions({ scopeVerdicts: [verdict({ path: 'vendor', verdict: 'exclude' })] })
    const states: string[] = []
    const { driver } = scriptedDriver(downstream(NO_ORCHESTRATE))
    const result = await runSpecScanSessions({
      repoRoot: repo,
      driver: async () => driver,
      persistence: memoryPersistence(),
      skipGit: true,
      disableScopeOrchestration: true,
      onScope: (state) => states.push(state),
    })
    expect(states).toEqual(['skipped'])
    expect(result.corpus.docs.map((d) => d.ref)).toEqual(['docs/a.md'])
  })
})
