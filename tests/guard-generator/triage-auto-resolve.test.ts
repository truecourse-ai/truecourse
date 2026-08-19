/**
 * THE AUTO-RESOLUTION LEDGER ACROSS RUNS. The triage STAGE is retired (plan 04
 * step 20) — a committed red's adjudication is the worker's own confirmed
 * `expectedReds` prediction — but the durable ledger it fed lives on, now fed
 * by the flow worker's `retired` outcomes (source `worker`) and by the fidelity
 * child's rejections (source `fidelity`).
 *
 * The safety valve is what this file is about: a flow that keeps retiring is
 * auto-resolved only so many times before it surfaces as a human task
 * ("re-generation is not fixing this"), and a flow that CONVERGES clears its
 * budget so the count never haunts a later regression. The single-run routing
 * of each outcome kind is `tests/guard-generator/flow-worker.test.ts`.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { autoResolutionKey } from '@truecourse/shared'
import { readGuardAutoResolutions, writeGuardAutoResolutions, loadScenarios } from '@truecourse/guard-runner'
import {
  PASSING_STEPS,
  extractSessionBy,
  makeTempRepo,
  raw,
  rmrf,
  runGenerate,
  submitWorkerSessions,
  writeCorpus,
  writeDoc,
  writeRecipe,
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

const versionCliBgUntestable = extractSessionBy({ background: { untestable: 'design history' } })
const KEY = autoResolutionKey('version', 'cli')
const EVIDENCE = 'no scenario asserts the exact version line the section quotes'

describe('the worker-fed auto-resolution ledger', () => {
  it('the whole loop, three generates: retire, retire, escalate (escalateAutoResolveAfter honored)', async () => {
    const r = seed()
    const run = () =>
      runGenerate({
        repoRoot: r,
        extractSession: versionCliBgUntestable,
        flowWorkerSession: submitWorkerSessions(() => ({ retired: { attempts: 3, lastEvidence: EVIDENCE } })),
        escalateAutoResolveAfter: 2,
      })

    const first = await run()
    expect(first.birthFindings).toEqual([])
    expect(readGuardAutoResolutions(r).entries[KEY]).toMatchObject({ count: 1, source: 'worker' })

    const second = await run()
    expect(second.birthFindings).toEqual([])
    expect(readGuardAutoResolutions(r).entries[KEY]!.count).toBe(2)

    // Past the budget: a human task instead of a third silent retirement.
    const third = await run()
    expect(third.birthFindings).toHaveLength(1)
    expect(third.birthFindings[0].autoResolveEscalation).toEqual({ count: 2, source: 'worker' })
    expect(third.birthFindings[0].actual).toContain(EVIDENCE)
    // …and the count is KEPT, not bumped — it stays escalated next run too.
    expect(readGuardAutoResolutions(r).entries[KEY]!.count).toBe(2)
  })

  it('a flow that CONVERGES clears its budget — the count never haunts a later regression', async () => {
    const r = seed()
    writeGuardAutoResolutions(r, {
      version: 1,
      entries: { [KEY]: { count: 2, source: 'worker', updatedAt: '2026-07-01T00:00:00Z' } },
      tainted: {},
    })
    await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: submitWorkerSessions(() => raw('now green', PASSING_STEPS)),
    })
    expect(loadScenarios(r).scenarios.map((s) => s.id)).toEqual(['version'])
    expect(readGuardAutoResolutions(r).entries[KEY]).toBeUndefined()
  }, 60_000)

  it('a clean run never creates the ledger file at all', async () => {
    const r = seed()
    await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: submitWorkerSessions(() => raw('green', PASSING_STEPS)),
    })
    const ledger = readGuardAutoResolutions(r)
    expect(ledger.entries).toEqual({})
    expect(ledger.tainted).toEqual({})
  }, 60_000)
})
