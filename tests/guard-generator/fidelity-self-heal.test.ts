/**
 * The fidelity self-heal. A green test the reviewer flags at HIGH
 * confidence is the system's own mess: the candidate is discarded and its flow
 * re-authored ONCE (the accepted one-flow-call cost), never a human task. Every
 * discard is an auditable `fidelity-discard` ledger row with the re-author's
 * outcome, counts against the flow's escalation budget, and a heal that did not
 * converge taints the flow for the next generate.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { autoResolutionKey } from '@truecourse/shared'
import { readGuardAutoResolutions, writeGuardAutoResolutions, loadScenarios } from '@truecourse/guard-runner'
import type { GenerateRunner } from '@truecourse/guard-generator'
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
  stampMilestones,
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

/** Round 1 authors `weak`; the self-heal re-author (priorFlag) returns `strong`. */
function healingRunner(steps = PASSING_STEPS): GenerateRunner {
  return async (ctx) =>
    ({
      scenario: stampMilestones(raw(ctx.priorFlag ? 'strong' : 'weak', steps), ctx.milestones.length),
    })
}

describe('fidelity self-heal', () => {
  it('a HIGH flag discards + re-authors ONCE; a faithful replacement commits clean (outcome resolved)', async () => {
    const r = seed()
    let reviews = 0
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: healingRunner(),
      fidelityRunner: reviewBy({ weak: { mismatch: MISMATCH, confidence: 'high' } }, () => reviews++),
    })

    // The replacement committed under the flow's stable id; no finding, no task.
    expect(res.written).toMatchObject([{ id: 'version.cli.1', title: 'strong', status: 'passing' }])
    expect(res.birthFindings).toEqual([])
    expect(loadScenarios(r).scenarios.map((s) => s.id)).toEqual(['version.cli.1'])
    expect(res.flows).toMatchObject({ settled: 1, unsettled: 0 })
    // Both the discarded candidate and its replacement were reviewed.
    expect(reviews).toBe(2)

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

  it('a replacement flagged AGAIN (any confidence) is a rejection — one heal per flow per run', async () => {
    const r = seed()
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: healingRunner(),
      fidelityRunner: reviewBy({
        weak: { mismatch: MISMATCH, confidence: 'high' },
        strong: { mismatch: 'still weak', confidence: 'high' },
      }),
    })
    expect(res.written).toEqual([])
    expect(res.birthFindings).toMatchObject([{ kind: 'fidelity', title: 'strong' }])
    expect(res.autoResolved).toMatchObject([{ kind: 'fidelity-discard', outcome: 'finding' }])
    expect(res.flows).toMatchObject({ settled: 0, unsettled: 1 })
    // Non-converged: counted AND tainted for the next generate.
    const ledger = readGuardAutoResolutions(r)
    expect(ledger.entries[KEY]).toMatchObject({ count: 1, source: 'fidelity' })
    expect(ledger.tainted[KEY]).toBeTruthy()
  })

  it('a replacement that FAILS birth routes like any failing test (here: untriaged ⇒ committed red)', async () => {
    const r = seed()
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: async (ctx) =>
        ({
          scenario: stampMilestones(
            ctx.priorFlag ? raw('strong', FAILING_STEPS) : raw('weak', PASSING_STEPS),
            ctx.milestones.length,
          ),
        }),
      fidelityRunner: reviewBy({ weak: { mismatch: MISMATCH, confidence: 'high' } }),
    })
    expect(res.autoResolved).toMatchObject([{ kind: 'fidelity-discard', outcome: 'finding' }])
    expect(res.written).toMatchObject([{ title: 'strong', status: 'failing' }])
    expect(res.birthFindings).toMatchObject([{ title: 'strong', committed: true }])
  })

  it('a medium flag never self-heals — a plain rejection, tainted, no ledger count', async () => {
    const r = seed()
    let authorCalls = 0
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: async (ctx) => {
        authorCalls++
        return { scenario: stampMilestones(raw('weak', PASSING_STEPS), ctx.milestones.length) }
      },
      fidelityRunner: reviewBy({ weak: { mismatch: MISMATCH, confidence: 'medium' } }),
    })
    expect(authorCalls).toBe(1)
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
    let authorCalls = 0
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: async (ctx) => {
        authorCalls++
        return { scenario: stampMilestones(raw('weak', PASSING_STEPS), ctx.milestones.length) }
      },
      fidelityRunner: reviewBy({ weak: { mismatch: MISMATCH, confidence: 'high' } }),
    })
    expect(authorCalls).toBe(1) // no heal call
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
