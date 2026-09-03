/**
 * THE VERDICT ROUTING (plan 05 step 23) — what a class does BESIDES landing on
 * the row. `authoring-defect` blames the scenario, so it taints the flow in the
 * durable auto-resolutions ledger (source `adjudicate`, the same
 * escalate-after-2 budget every other auto behavior spends) and, at high
 * confidence on a scenario-layer fix, dismisses the claim the failure resolves
 * to through the existing auto tier. Every other class routes nowhere: it is
 * recorded and read.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readGuardAutoResolutions, readGuardDecisions, writeGuardLatest } from '@truecourse/guard-runner'
import {
  autoResolutionKey,
  type GuardFlow,
  type GuardLatest,
  type GuardScenarioAdjudication,
  type GuardScenarioDiagnosis,
  type GuardScenarioResult,
} from '@truecourse/shared'
import { claimIdentity, persistAdjudication } from '../../packages/core/src/services/guard-adjudicate/fold'
import type { AdjudicationItem } from '../../packages/core/src/services/guard-adjudicate/pre-pass'

let repo: string

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-adjudicate-routing-'))
  // A board holding the row, so the persist half has something to patch.
  writeGuardLatest(repo, board())
})
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true })
})

function row(over: Partial<GuardScenarioResult> = {}): GuardScenarioResult {
  return {
    id: 'a',
    title: 'a title',
    binds: { doc: 'docs/x.md', section: 'a/sec', fingerprint: 'sha256:x' },
    outcome: 'fail',
    durationMs: 1,
    failure: { step: 2, expected: 'exit 0', actual: 'exit 2 — unknown flag' },
    ...over,
  }
}

function board(): GuardLatest {
  return {
    run: {
      runId: 'r1',
      ranAt: '2026-01-01T00:00:00.000Z',
      branch: 'main',
      commit: 'deadbeef',
      recipeFingerprint: 'sha256:r',
    },
    summary: { total: 1, pass: 0, fail: 1, stale: 0, orphaned: 0, error: 0, blocked: 0 },
    scenarios: [row()],
    sections: [],
  }
}

const DIAGNOSIS: GuardScenarioDiagnosis = {
  doc: 'docs/cli.md',
  anchor: 'flags/verbose',
  title: 'the verbose flag',
  claim: '`relkit --verbose` prints the resolved config',
  step: 2,
  expected: 'exit 0',
  actual: 'exit 2 — unknown flag',
  file: '.truecourse/scenarios/cli/verbose.yaml',
}

const FLOW: GuardFlow = {
  id: 'flow-1',
  title: 'the verbose flow',
  goal: 'see the resolved config',
  fingerprint: 'sha256:flow',
  milestones: [
    { order: 1, doc: 'docs/cli.md', anchor: 'flags', claimTitle: 'flags exist' },
    { order: 2, doc: 'docs/cli.md', anchor: 'flags/verbose', claimTitle: 'the verbose flag prints config' },
  ],
  bindings: [{ doc: 'docs/cli.md', anchor: 'flags/verbose', fingerprint: 'sha256:x' }],
  composedOf: [],
  synthesisInputsHash: 'sha256:inputs',
}

function item(over: Partial<AdjudicationItem> = {}): AdjudicationItem {
  return {
    scenarioId: 'a',
    title: 'a title',
    outcome: 'fail',
    runId: 'r1',
    row: row(),
    step: 2,
    expected: 'exit 0',
    actual: 'exit 2 — unknown flag',
    surface: 'cli',
    flowId: 'flow-1',
    ...over,
  }
}

function defect(over: Partial<GuardScenarioAdjudication> = {}): GuardScenarioAdjudication {
  return {
    class: 'authoring-defect',
    mechanism: 'the assertion names a `--verbose` flag the CLI never had',
    evidence: ['exit 2 — unknown flag'],
    fix: { layer: 'scenario', description: 'assert on `--debug`' },
    confidence: 'medium',
    findings: [],
    adjudicatedAt: '2026-02-01T00:00:00.000Z',
    ...over,
  }
}

const KEY = autoResolutionKey('flow-1', 'cli')
const dismissals = () => readGuardDecisions(repo).dismissedClaims

describe('the ledger — an authoring-defect taints its flow under source `adjudicate`', () => {
  it('counts up to the escalation threshold, then escalates', async () => {
    const first = await persistAdjudication({ repoRoot: repo, item: item(), verdict: defect() })
    expect(first.routing.tainted).toEqual({ key: KEY, count: 1, escalated: false })
    const ledger = readGuardAutoResolutions(repo)
    expect(ledger.entries[KEY]).toMatchObject({ count: 1, source: 'adjudicate' })
    // The taint carries the mechanism forward as correction evidence for the next
    // generate's fresh re-author.
    expect(ledger.tainted[KEY]).toMatchObject({
      flowId: 'flow-1',
      surface: 'cli',
      mismatch: 'the assertion names a `--verbose` flag the CLI never had',
    })

    const second = await persistAdjudication({ repoRoot: repo, item: item(), verdict: defect() })
    expect(second.routing.tainted).toEqual({ key: KEY, count: 2, escalated: false })

    // Past the budget: re-generation is not fixing this, so it becomes a human's.
    const third = await persistAdjudication({
      repoRoot: repo,
      item: item({ diagnosis: DIAGNOSIS }),
      verdict: defect({ confidence: 'high' }),
    })
    expect(third.routing.tainted).toEqual({ key: KEY, count: 3, escalated: true })
    expect(readGuardAutoResolutions(repo).entries[KEY].count).toBe(3)
    // …and the escalation HOLDS BACK the auto tier: nothing auto-resolves again,
    // even though this verdict is high-confidence with a resolvable claim.
    expect(third.routing.autoDismissed).toBeUndefined()
    expect(dismissals()).toEqual([])
  })

  it('taints nothing when the scenario belongs to no flow', async () => {
    const { scenarioId, title, outcome, runId, row: r, step, expected, actual, surface } = item()
    const result = await persistAdjudication({
      repoRoot: repo,
      item: { scenarioId, title, outcome, runId, row: r, step, expected, actual, surface },
      verdict: defect({ confidence: 'high', fix: { layer: 'scenario', description: 'x' } }),
    })
    expect(result.routing).toEqual({})
    expect(readGuardAutoResolutions(repo).entries).toEqual({})
  })

  // The fold PATCHES the ledger it reads (the store's read-patch-write idiom), so
  // a reader that handed out one shared empty object would carry this repo's
  // counts and taints into the next ledgerless repo of the same process — the
  // dashboard server and any two-repo CLI run being the real cases.
  it('keeps two repos of one process apart when neither has a ledger file yet', async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-adjudicate-routing-other-'))
    try {
      await persistAdjudication({ repoRoot: repo, item: item(), verdict: defect() })
      expect(readGuardAutoResolutions(repo).entries[KEY]).toMatchObject({ count: 1 })

      // The second repo has no `guard/auto-resolutions.json` at all: it must read
      // as empty, and its own first defect must start the budget over at 1.
      expect(readGuardAutoResolutions(other)).toEqual({ version: 1, entries: {}, tainted: {} })
      writeGuardLatest(other, board())
      const fresh = await persistAdjudication({ repoRoot: other, item: item(), verdict: defect() })
      expect(fresh.routing.tainted).toEqual({ key: KEY, count: 1, escalated: false })
      expect(readGuardAutoResolutions(repo).entries[KEY].count).toBe(1)

      // Every empty read is its own object — nothing downstream can alias.
      const a = readGuardAutoResolutions(path.join(other, 'nowhere-a'))
      const b = readGuardAutoResolutions(path.join(other, 'nowhere-b'))
      expect(a).not.toBe(b)
      expect(a.entries).not.toBe(b.entries)
    } finally {
      fs.rmSync(other, { recursive: true, force: true })
    }
  })

  it('routes nothing for the classes that are recorded and read', async () => {
    for (const verdict of [
      { class: 'bug' as const, code: { file: 'src/a.ts', line: 1 } },
      { class: 'drift' as const },
      { class: 'infrastructure' as const },
      { class: 'seed-defect' as const, fix: { layer: 'seed' as const, description: 'x' } },
      { class: 'expected-red' as const },
    ]) {
      const result = await persistAdjudication({
        repoRoot: repo,
        item: item({ diagnosis: DIAGNOSIS }),
        verdict: { ...defect({ confidence: 'high' }), ...verdict },
      })
      expect(result.routing).toEqual({})
    }
    expect(readGuardAutoResolutions(repo).entries).toEqual({})
    expect(dismissals()).toEqual([])
  })
})

describe('the auto tier — a high-confidence scenario-layer defect dismisses its claim', () => {
  it('writes exactly one dismissal however many times the same verdict is folded', async () => {
    const verdict = defect({ confidence: 'high' })
    const first = await persistAdjudication({
      repoRoot: repo,
      item: item({ diagnosis: DIAGNOSIS }),
      verdict,
      now: () => '2026-02-01T00:00:00.000Z',
    })
    expect(first.routing.autoDismissed).toEqual({
      doc: 'docs/cli.md',
      anchor: 'flags/verbose',
      title: '`relkit --verbose` prints the resolved config',
    })
    expect(dismissals()).toEqual([
      {
        doc: 'docs/cli.md',
        anchor: 'flags/verbose',
        title: '`relkit --verbose` prints the resolved config',
        dismissedAt: '2026-02-01T00:00:00.000Z',
        auto: true,
        reason: 'the assertion names a `--verbose` flag the CLI never had',
      },
    ])

    // A scoped re-adjudication reaches the same verdict: the dismissal is keyed by
    // identity, so it refreshes rather than duplicating.
    await persistAdjudication({
      repoRoot: repo,
      item: item({ diagnosis: DIAGNOSIS }),
      verdict,
      now: () => '2026-02-02T00:00:00.000Z',
    })
    expect(dismissals()).toHaveLength(1)
    expect(dismissals()[0].dismissedAt).toBe('2026-02-02T00:00:00.000Z')
  })

  it('holds back on medium confidence, on a non-scenario fix layer, and with no claim identity', async () => {
    // Medium confidence — the auto tier is for the calls the machine is sure of.
    await persistAdjudication({ repoRoot: repo, item: item({ diagnosis: DIAGNOSIS }), verdict: defect() })
    expect(dismissals()).toEqual([])

    // The seed is wrong, not the claim: dismissing the claim would hide a real gap.
    await persistAdjudication({
      repoRoot: repo,
      item: item({ diagnosis: DIAGNOSIS }),
      verdict: defect({ confidence: 'high', fix: { layer: 'seed', description: 'seed the user first' } }),
    })
    expect(dismissals()).toEqual([])

    // Nothing resolves to a claim: a dismissal without an identity keys on nothing.
    await persistAdjudication({
      repoRoot: repo,
      item: item(),
      verdict: defect({ confidence: 'high' }),
    })
    expect(dismissals()).toEqual([])
  })

  it('falls back to the failing milestone when the diagnosis names no claim', async () => {
    const result = await persistAdjudication({
      repoRoot: repo,
      item: item({ row: row({ failedMilestone: 2 }), flow: FLOW }),
      verdict: defect({ confidence: 'high' }),
    })
    expect(result.routing.autoDismissed).toEqual({
      doc: 'docs/cli.md',
      anchor: 'flags/verbose',
      title: 'the verbose flag prints config',
    })
    expect(dismissals()).toHaveLength(1)
    expect(dismissals()[0].title).toBe('the verbose flag prints config')
  })
})

describe('claimIdentity — what a dismissal keys on', () => {
  it('prefers the committed diagnosis, falls back to the failing milestone, else null', () => {
    expect(claimIdentity(item({ diagnosis: DIAGNOSIS }))).toEqual({
      doc: 'docs/cli.md',
      anchor: 'flags/verbose',
      title: '`relkit --verbose` prints the resolved config',
    })
    // A diagnosis with no `claim` is not an identity — the milestone answers.
    const { claim: _dropped, ...noClaim } = DIAGNOSIS
    expect(claimIdentity(item({ diagnosis: noClaim, row: row({ failedMilestone: 1 }), flow: FLOW }))).toEqual({
      doc: 'docs/cli.md',
      anchor: 'flags',
      title: 'flags exist',
    })
    // A milestone order the flow has no entry for resolves to nothing.
    expect(claimIdentity(item({ row: row({ failedMilestone: 9 }), flow: FLOW }))).toBeNull()
    expect(claimIdentity(item())).toBeNull()
  })
})
