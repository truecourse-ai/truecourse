/**
 * Retirement durability + its three resets. A retired flow×surface (the
 * auto-resolve budget exhausted) settles as a `retired` coverage gap and costs
 * NOTHING on later generates — no match call, no worker session — until exactly
 * one of three resets fires: (a) the flow's bound spec content moves, (b) the user
 * re-enables it via `reenabledFlows` in `scenarios/decisions.json`, (c) the
 * surface's authoring prompt moves (the engine improved). Each reset clears the
 * retirement AND its ledger count, so the fresh attempt starts its budget over.
 * Deleting the ledger resets too (it is transient run memory, safe to delete).
 *
 * The budget is driven here by the fidelity reviewer — a HIGH-confidence flag on
 * every attempt, the "this test does not verify what the flow promises" verdict
 * that costs a heal and then retires. (An exhausted worker session spends the same
 * budget under the `author` source; see triage-auto-resolve.test.ts.)
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { autoResolutionKey } from '@truecourse/shared'
import {
  guardAutoResolutionsPath,
  readGuardAutoResolutions,
  readManifest,
  writeGuardAutoResolutions,
} from '@truecourse/guard-runner'
import { WORKER_CLI_PROMPT_FINGERPRINT, type GuardGenerateResult } from '@truecourse/guard-generator'
import type { LlmTurnRequest } from '@truecourse/shared/llm'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  extractBy,
  reviewBy,
  workerTurnBy,
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

const MISMATCH = 'asserts only the exit code where the claim quotes the printed version'

/** One generate whose only flow settles a green scenario the reviewer flags at
 *  HIGH confidence — with `escalateAutoResolveAfter: 1`, the second run retires. */
function defectiveRun(r: string, onTurn?: (req: LlmTurnRequest) => void): Promise<GuardGenerateResult> {
  return runGenerate({
    repoRoot: r,
    extractRunner: versionCliBgUntestable,
    turnFn: workerTurnBy({ version: raw('always shallow', PASSING_STEPS) }, onTurn),
    fidelityRunner: reviewBy({ 'always shallow': { mismatch: MISMATCH, confidence: 'high' } }),
    escalateAutoResolveAfter: 1,
  })
}

/** Count the worker turns a run spends on the `version` flow. */
function turnsOn(flowId: string, turns: LlmTurnRequest[]): number {
  return turns.filter((t) => t.subject === flowId).length
}

/** Drive a fresh repo to the retired state (auto-resolve, then retire). */
async function retireVersionFlow(r: string): Promise<void> {
  const first = await defectiveRun(r)
  expect(first.autoResolved).toEqual([expect.objectContaining({ kind: 'fidelity-discard' })])
  const second = await defectiveRun(r)
  expect(second.autoResolved).toEqual([
    expect.objectContaining({ kind: 'retire', source: 'fidelity', attempts: 2 }),
  ])
  expect(readGuardAutoResolutions(r).retired[KEY]).toBeTruthy()
}

describe('flow retirement — durable skip', () => {
  it('a retired flow costs nothing: zero worker turns, the gap re-derives, the flow stays settled', async () => {
    const r = seed()
    await retireVersionFlow(r)
    // The retirement stored the WORKER's authoring prompt as its reset anchor.
    expect(readGuardAutoResolutions(r).retired[KEY]!.promptFingerprint).toBe(WORKER_CLI_PROMPT_FINGERPRINT)

    const turns: LlmTurnRequest[] = []
    const third = await defectiveRun(r, (req) => turns.push(req))
    expect(turnsOn('version', turns)).toBe(0)
    expect(third.autoResolved).toEqual([])
    expect(third.birthFindings).toEqual([])
    expect(third.coverageGaps).toContainEqual(
      expect.objectContaining({
        kind: 'retired',
        flowId: 'version',
        surface: 'cli',
        reason: 'no test — authoring retired after 2 defective attempts',
      }),
    )
    const entry = readManifest(r)!.flows.find((f) => f.flowId === 'version')!
    expect(entry.generationInputsHash).not.toBeNull()
    expect(entry.gaps).toEqual([
      { surface: 'cli', kind: 'retired', reason: 'no test — authoring retired after 2 defective attempts' },
    ])

    // And the run after that is a full no-op skip for the flow.
    const laterTurns: LlmTurnRequest[] = []
    const fourth = await defectiveRun(r, (req) => laterTurns.push(req))
    expect(turnsOn('version', laterTurns)).toBe(0)
    expect(fourth.flows.skipped).toBe(1)
    expect(readGuardAutoResolutions(r).retired[KEY]).toBeTruthy()
  })
})

describe('flow retirement — the three resets', () => {
  it('(a) the bound spec content moves — the flow re-authors with a fresh budget', async () => {
    const r = seed()
    await retireVersionFlow(r)

    writeDoc(r, DOC, DOC_CONTENT.replace('prints the version', 'prints the semver version'))
    const turns: LlmTurnRequest[] = []
    const res = await defectiveRun(r, (req) => turns.push(req))
    expect(turnsOn('version', turns)).toBeGreaterThan(0)
    // A fresh attempt with a fresh budget: it auto-resolves again, never escalates.
    expect(res.autoResolved).toEqual([expect.objectContaining({ kind: 'fidelity-discard' })])
    const ledger = readGuardAutoResolutions(r)
    expect(ledger.retired[KEY]).toBeUndefined()
    expect(ledger.entries[KEY]).toMatchObject({ count: 1 })
  })

  it('(b) the user re-enables via decisions.json — cleared, re-authored, budget over', async () => {
    const r = seed()
    await retireVersionFlow(r)

    const decisionsPath = path.join(r, '.truecourse', 'scenarios', 'decisions.json')
    fs.writeFileSync(
      decisionsPath,
      JSON.stringify({
        version: 1,
        reenabledFlows: [
          { flowId: 'version', reenabledAt: new Date(Date.now() + 60_000).toISOString(), note: 'try again' },
        ],
      }),
    )
    const turns: LlmTurnRequest[] = []
    const res = await defectiveRun(r, (req) => turns.push(req))
    expect(turnsOn('version', turns)).toBeGreaterThan(0)
    expect(res.autoResolved).toEqual([expect.objectContaining({ kind: 'fidelity-discard' })])
    const ledger = readGuardAutoResolutions(r)
    expect(ledger.retired[KEY]).toBeUndefined()
    expect(ledger.entries[KEY]).toMatchObject({ count: 1 })
  })

  it('(b) a re-enable OLDER than the retirement does NOT reset — a later re-retirement stands', async () => {
    const r = seed()
    await retireVersionFlow(r)

    const decisionsPath = path.join(r, '.truecourse', 'scenarios', 'decisions.json')
    fs.writeFileSync(
      decisionsPath,
      JSON.stringify({
        version: 1,
        reenabledFlows: [{ flowId: 'version', reenabledAt: '2020-01-01T00:00:00Z' }],
      }),
    )
    const turns: LlmTurnRequest[] = []
    await defectiveRun(r, (req) => turns.push(req))
    expect(turnsOn('version', turns)).toBe(0)
    expect(readGuardAutoResolutions(r).retired[KEY]).toBeTruthy()
  })

  it('(c) the authoring prompt moves (the engine improved) — the retired flow earns a fresh attempt', async () => {
    const r = seed()
    await retireVersionFlow(r)

    // Simulate a retirement recorded under an older author: the stored prompt
    // fingerprint no longer matches the current one.
    const ledger = readGuardAutoResolutions(r)
    writeGuardAutoResolutions(r, {
      ...ledger,
      retired: { [KEY]: { ...ledger.retired[KEY]!, promptFingerprint: 'sha256:previous-author' } },
    })
    const turns: LlmTurnRequest[] = []
    const res = await defectiveRun(r, (req) => turns.push(req))
    expect(turnsOn('version', turns)).toBeGreaterThan(0)
    expect(res.autoResolved).toEqual([expect.objectContaining({ kind: 'fidelity-discard' })])
    expect(readGuardAutoResolutions(r).retired[KEY]).toBeUndefined()
  })

  it('(c) the worker rewrite wakes a flow retired under the old one-shot cli author', async () => {
    // The cli surface authors through a WORKER SESSION now, which rolled the cli
    // authoring fingerprint. A flow retired under the OLD one-shot author (whose
    // single blind draft could only repeat the mistake) carries that author's
    // fingerprint in the ledger, so the rewrite itself is its reset: it re-authors
    // against the machinery it never had.
    const r = seed()
    await retireVersionFlow(r)

    const ledger = readGuardAutoResolutions(r)
    writeGuardAutoResolutions(r, {
      ...ledger,
      // A pinned pre-worker cli author fingerprint (see prompts.test.ts).
      retired: { [KEY]: { ...ledger.retired[KEY]!, promptFingerprint: '51c1ea533c42a935' } },
    })
    const turns: LlmTurnRequest[] = []
    await defectiveRun(r, (req) => turns.push(req))
    expect(turnsOn('version', turns)).toBeGreaterThan(0)
    expect(readGuardAutoResolutions(r).retired[KEY]).toBeUndefined()
  })

  it('a deleted ledger resets too — the prior retired gap forces a fresh attempt', async () => {
    const r = seed()
    await retireVersionFlow(r)

    fs.rmSync(guardAutoResolutionsPath(r))
    // The flow is forced back into work (its hash still matches) and re-attempts
    // with an empty budget — the taint died with the ledger, so authoring is a
    // cache hit; the fresh attempt shows in the outcome, not in turn counts. With
    // no session to heal into, the flag is a plain rejection finding.
    const turns: LlmTurnRequest[] = []
    const res = await defectiveRun(r, (req) => turns.push(req))
    expect(res.flows.skipped).toBe(0)
    expect(turnsOn('version', turns)).toBe(0)
    expect(res.birthFindings).toMatchObject([{ kind: 'fidelity', flowId: 'version' }])
    expect(readGuardAutoResolutions(r).entries[KEY]).toMatchObject({ count: 1, source: 'fidelity' })
    // The stale `retired` gap is gone — the flow is honest pending work again.
    const entry = readManifest(r)!.flows.find((f) => f.flowId === 'version')!
    expect(entry.gaps).toEqual([])
    expect(entry.generationInputsHash).toBeNull()
  })
})
