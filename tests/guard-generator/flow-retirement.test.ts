/**
 * Retirement durability + its three resets. A retired flow×surface (the
 * auto-resolve budget exhausted) settles as a `retired` coverage gap and costs
 * NOTHING on later generates — no match call, no author call — until exactly one
 * of three resets fires: (a) the flow's bound spec content moves, (b) the user
 * re-enables it via `reenabledFlows` in `scenarios/decisions.json`, (c) the
 * surface's authoring prompt moves (the engine improved). Each reset clears the
 * retirement AND its ledger count, so the fresh attempt starts its budget over.
 * Deleting the ledger resets too (it is transient run memory, safe to delete).
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { GuardTriage } from '@truecourse/shared'
import { autoResolutionKey } from '@truecourse/shared'
import {
  guardAutoResolutionsPath,
  readGuardAutoResolutions,
  readManifest,
  writeGuardAutoResolutions,
} from '@truecourse/guard-runner'
import type { GuardGenerateResult } from '@truecourse/guard-generator'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  extractBy,
  authorBy,
  runGenerate,
  FAILING_STEPS,
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

const genDefect: GuardTriage = {
  verdict: 'generation-defect',
  confidence: 'high',
  brief: 'The scenario asserts an exit code the section never states.',
  recommendation: 'Author against the documented behavior instead.',
}

/** One generate whose only flow authors a failing test judged generation-defect
 *  at HIGH confidence — with `escalateAutoResolveAfter: 1`, the second run retires. */
function defectiveRun(r: string, onAuthor?: () => void): Promise<GuardGenerateResult> {
  return runGenerate({
    repoRoot: r,
    extractRunner: versionCliBgUntestable,
    generateRunner: authorBy({ version: raw('always broken', FAILING_STEPS) }, onAuthor),
    triageRunner: async () => genDefect,
    escalateAutoResolveAfter: 1,
  })
}

/** Drive a fresh repo to the retired state (auto-resolve, then retire). */
async function retireVersionFlow(r: string): Promise<void> {
  await defectiveRun(r)
  const second = await defectiveRun(r)
  expect(second.autoResolved).toEqual([expect.objectContaining({ kind: 'retire', attempts: 2 })])
  expect(readGuardAutoResolutions(r).retired[KEY]).toBeTruthy()
}

describe('flow retirement — durable skip', () => {
  it('a retired flow costs nothing: zero author calls, the gap re-derives, the flow stays settled', async () => {
    const r = seed()
    await retireVersionFlow(r)

    let authorCalls = 0
    const third = await defectiveRun(r, () => authorCalls++)
    expect(authorCalls).toBe(0)
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
    let laterCalls = 0
    const fourth = await defectiveRun(r, () => laterCalls++)
    expect(laterCalls).toBe(0)
    expect(fourth.flows.skipped).toBe(1)
    expect(readGuardAutoResolutions(r).retired[KEY]).toBeTruthy()
  })
})

describe('flow retirement — the three resets', () => {
  it('(a) the bound spec content moves — the flow re-authors with a fresh budget', async () => {
    const r = seed()
    await retireVersionFlow(r)

    writeDoc(r, DOC, DOC_CONTENT.replace('prints the version', 'prints the semver version'))
    let authorCalls = 0
    const res = await defectiveRun(r, () => authorCalls++)
    expect(authorCalls).toBeGreaterThan(0)
    // A fresh attempt with a fresh budget: it auto-resolves again, never escalates.
    expect(res.autoResolved).toEqual([expect.objectContaining({ kind: 'triage-resolve' })])
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
    let authorCalls = 0
    const res = await defectiveRun(r, () => authorCalls++)
    expect(authorCalls).toBeGreaterThan(0)
    expect(res.autoResolved).toEqual([expect.objectContaining({ kind: 'triage-resolve' })])
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
    let authorCalls = 0
    await defectiveRun(r, () => authorCalls++)
    expect(authorCalls).toBe(0)
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
    let authorCalls = 0
    const res = await defectiveRun(r, () => authorCalls++)
    expect(authorCalls).toBeGreaterThan(0)
    expect(res.autoResolved).toEqual([expect.objectContaining({ kind: 'triage-resolve' })])
    expect(readGuardAutoResolutions(r).retired[KEY]).toBeUndefined()
  })

  it('a deleted ledger resets too — the prior retired gap forces a fresh attempt', async () => {
    const r = seed()
    await retireVersionFlow(r)

    fs.rmSync(guardAutoResolutionsPath(r))
    // The flow is forced back into work (its hash still matches) and re-attempts
    // with an empty budget — the taint died with the ledger, so authoring is a
    // cache hit; the fresh attempt shows in the outcome, not in call counts.
    const res = await defectiveRun(r)
    expect(res.flows.skipped).toBe(0)
    expect(res.autoResolved).toEqual([expect.objectContaining({ kind: 'triage-resolve' })])
    // The stale `retired` gap is gone — the flow is honest pending work again.
    const entry = readManifest(r)!.flows.find((f) => f.flowId === 'version')!
    expect(entry.gaps).toEqual([])
    expect(entry.generationInputsHash).toBeNull()
  })
})
