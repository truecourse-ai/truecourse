/**
 * The fidelity self-heal under worker sessions. A green settle the reviewer flags
 * at HIGH confidence is the system's own mess: the session that authored it is
 * still open, so it RESUMES once with the flag (the heal), revises, re-runs, and
 * re-settles — never a human task. The revised settle gets ONE more review. Every
 * heal is an auditable `fidelity-discard` ledger row carrying its outcome, counts
 * against the flow's escalation budget, and a heal that did not converge taints the
 * flow for the next generate.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { autoResolutionKey } from '@truecourse/shared'
import { readGuardAutoResolutions, writeGuardAutoResolutions, loadScenarios } from '@truecourse/guard-runner'
import type { LlmTurnRequest } from '@truecourse/shared/llm'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  extractBy,
  runGenerate,
  reviewBy,
  workerTurnBy,
  FAILING_STEPS,
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
  'The history of relkit; nothing externally observable here.',
].join('\n')

function seed(): string {
  const r = repo()
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, DOC_CONTENT)
  return r
}

const versionCliBgUntestable = extractBy({ background: { untestable: 'design history' } })
const KEY = autoResolutionKey('version', 'cli')
const MISMATCH = 'asserts exit 0 where the claim quotes the exact version line'

/**
 * The session's own convergence pair: it settles on `weak` first, and the heal
 * resume (the reviewer's flag arriving as an observation) revises to `strong`.
 */
function healingSession(revisedSteps = PASSING_STEPS) {
  return workerTurnBy({
    version: { first: raw('weak', PASSING_STEPS), retry: raw('strong', revisedSteps) },
  })
}

/** Count the sessions a turn fn was driven through: a fresh session opens with a
 *  single message, a resume carries the whole prior transcript. */
function sessionCounter(): { opened: () => number; onTurn: (req: LlmTurnRequest) => void } {
  let opened = 0
  return {
    opened: () => opened,
    onTurn: (req) => {
      if (req.messages.length === 1) opened++
    },
  }
}

describe('fidelity self-heal', () => {
  it('a HIGH flag RESUMES the session ONCE; a faithful revision commits clean (outcome resolved)', async () => {
    const r = seed()
    let reviews = 0
    const resumes: [number, number][] = []
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      turnFn: healingSession(),
      fidelityRunner: reviewBy({ weak: { mismatch: MISMATCH, confidence: 'high' } }, () => reviews++),
      onRetryProgress: (done, total) => resumes.push([done, total]),
    })

    // The revision committed under the flow's stable id; no finding, no task.
    expect(res.written).toMatchObject([{ id: 'version.cli.1', title: 'strong', status: 'passing' }])
    expect(res.birthFindings).toEqual([])
    expect(loadScenarios(r).scenarios.map((s) => s.id)).toEqual(['version.cli.1'])
    expect(res.flows).toMatchObject({ settled: 1, unsettled: 0 })
    // Both the flagged settle and its revision were reviewed.
    expect(reviews).toBe(2)
    // The heal is a session RESUME, and the resume hook accounts for exactly one.
    expect(resumes).toEqual([
      [0, 1],
      [1, 1],
    ])

    // The auditable record: one discard row carrying the outcome.
    expect(res.autoResolved).toEqual([
      {
        kind: 'fidelity-discard',
        flowId: 'version',
        surface: 'cli',
        doc: DOC,
        anchor: 'version',
        title: 'weak',
        mismatch: MISMATCH,
        outcome: 'resolved',
      },
    ])
    // The identity: birthPassed = passing writes + rejections + discards.
    expect(res.birthPassed).toBe(2)
    // Converged: the budget cleared, nothing tainted.
    const ledger = readGuardAutoResolutions(r)
    expect(ledger.entries[KEY]).toBeUndefined()
    expect(ledger.tainted[KEY]).toBeUndefined()
  })

  it('a revision flagged AGAIN (any confidence) is a rejection — one heal per flow per run', async () => {
    const r = seed()
    const resumes: [number, number][] = []
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      turnFn: healingSession(),
      fidelityRunner: reviewBy({
        weak: { mismatch: MISMATCH, confidence: 'high' },
        strong: { mismatch: 'still weak', confidence: 'high' },
      }),
      onRetryProgress: (done, total) => resumes.push([done, total]),
    })
    expect(res.written).toEqual([])
    expect(res.birthFindings).toMatchObject([{ kind: 'fidelity', title: 'strong' }])
    expect(res.autoResolved).toMatchObject([{ kind: 'fidelity-discard', outcome: 'finding' }])
    expect(res.flows).toMatchObject({ settled: 0, unsettled: 1 })
    // Exactly ONE resume: a second flag is never healed again.
    expect(resumes).toEqual([
      [0, 1],
      [1, 1],
    ])
    // Non-converged: counted AND tainted for the next generate.
    const ledger = readGuardAutoResolutions(r)
    expect(ledger.entries[KEY]).toMatchObject({ count: 1, source: 'fidelity' })
    expect(ledger.tainted[KEY]).toBeTruthy()
  })

  it('a revision the sandbox FAILS settles failing and commits red with the session’s diagnosis', async () => {
    const r = seed()
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      turnFn: healingSession(FAILING_STEPS),
      fidelityRunner: reviewBy({ weak: { mismatch: MISMATCH, confidence: 'high' } }),
    })
    expect(res.autoResolved).toMatchObject([{ kind: 'fidelity-discard', outcome: 'finding' }])
    expect(res.written).toMatchObject([{ title: 'strong', status: 'failing' }])
    // The worker's own diagnosis rides the committed failure — there is no
    // after-the-fact triage stage to supply one.
    expect(res.birthFindings).toMatchObject([
      { title: 'strong', committed: true, triage: { verdict: 'code-drift', confidence: 'high' } },
    ])
  })

  it('a medium flag never self-heals — a plain rejection, tainted, no ledger count', async () => {
    const r = seed()
    const sessions = sessionCounter()
    const resumes: [number, number][] = []
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      turnFn: workerTurnBy({ version: raw('weak', PASSING_STEPS) }, sessions.onTurn),
      fidelityRunner: reviewBy({ weak: { mismatch: MISMATCH, confidence: 'medium' } }),
      onRetryProgress: (done, total) => resumes.push([done, total]),
    })
    expect(sessions.opened()).toBe(1) // one session, never resumed
    expect(resumes).toEqual([])
    expect(res.autoResolved).toEqual([])
    expect(res.birthFindings).toMatchObject([{ kind: 'fidelity' }])
    expect(res.birthFindings[0].autoResolveEscalation).toBeUndefined()
    const ledger = readGuardAutoResolutions(r)
    expect(ledger.entries[KEY]).toBeUndefined()
    expect(ledger.tainted[KEY]).toBeTruthy()
  })

  it('past the budget a HIGH flag RETIRES the flow instead of healing — the safety valve', async () => {
    const r = seed()
    writeGuardAutoResolutions(r, {
      version: 1,
      entries: { [KEY]: { count: 2, source: 'fidelity', updatedAt: '2026-07-01T00:00:00Z' } },
      tainted: {},
      retired: {},
    })
    const sessions = sessionCounter()
    const resumes: [number, number][] = []
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      turnFn: workerTurnBy({ version: raw('weak', PASSING_STEPS) }, sessions.onTurn),
      fidelityRunner: reviewBy({ weak: { mismatch: MISMATCH, confidence: 'high' } }),
      onRetryProgress: (done, total) => resumes.push([done, total]),
    })
    expect(sessions.opened()).toBe(1)
    expect(resumes).toEqual([]) // no heal resume
    // No finding, no task: the flow settles as a `retired` gap with the visible row.
    expect(res.birthFindings).toEqual([])
    expect(res.autoResolved).toEqual([
      expect.objectContaining({ kind: 'retire', source: 'fidelity', title: 'weak', attempts: 3 }),
    ])
    expect(res.coverageGaps).toContainEqual(
      expect.objectContaining({
        kind: 'retired',
        flowId: 'version',
        surface: 'cli',
        reason: 'no test — authoring retired after 3 defective attempts',
      }),
    )
    expect(res.flows).toMatchObject({ settled: 1, unsettled: 0 })
    // A fidelity retirement is a surviving birth pass (the B6 identity).
    expect(res.birthPassed).toBe(1)
    const ledger = readGuardAutoResolutions(r)
    expect(ledger.retired[KEY]).toMatchObject({ attempts: 3 })
    expect(ledger.entries[KEY]).toBeUndefined()
    expect(ledger.tainted[KEY]).toBeTruthy()
  })
})
