/**
 * The flow taint on the WORKER path (plan 04 step 17). A flow whose test was
 * rejected last run must never be served the byte-identical rejected scenario
 * from the `guard/generate` cache again: the engine hands the worker task a
 * `taint` (core skips the cache read on it — pinned in
 * `tests/core/guard-generate-worker-seam.test.ts`), the briefing opens with the
 * prior mismatch as a PRIOR FLAG evidence block, a settled/blocked outcome
 * clears the taint, and a failed session keeps it.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { autoResolutionKey } from '@truecourse/shared'
import { readGuardAutoResolutions, writeGuardAutoResolutions, writeManifest } from '@truecourse/guard-runner'
import type { FlowWorkerTask } from '@truecourse/guard-generator'
import {
  PASSING_STEPS,
  extractSessionBy,
  flowWorkerSessionOf,
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

function taintedLedger(mismatch: string) {
  return {
    version: 1 as const,
    entries: {},
    tainted: {
      [KEY]: {
        flowId: 'version',
        surface: 'cli' as const,
        title: 'the rejected scenario',
        mismatch,
        updatedAt: '2026-07-01T00:00:00Z',
      },
    },
  }
}

describe('flow taint — what the worker is told, and when the taint clears', () => {
  it('a tainted flow reaches its worker with the taint AND a PRIOR FLAG briefing; a settled outcome clears it', async () => {
    const r = seed()
    const mismatch = 'asserts exit 0 where the claim quotes exact output'
    writeGuardAutoResolutions(r, taintedLedger(mismatch))

    const taints: (FlowWorkerTask['taint'] | undefined)[] = []
    let briefing = ''
    await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: submitWorkerSessions(
        (task) => {
          taints.push(task.taint)
          return raw('a genuinely different scenario', PASSING_STEPS)
        },
        {
          onSubmit: () => undefined,
        },
      ),
      onWorkerProgress: () => undefined,
    })

    expect(taints).toEqual([{ title: 'the rejected scenario', mismatch }])
    // The settled outcome overwrote the poisoned entry ⇒ the taint clears.
    expect(readGuardAutoResolutions(r).tainted[KEY]).toBeUndefined()

    // …and the BRIEFING the worker would have opened with carries the evidence.
    writeGuardAutoResolutions(r, taintedLedger(mismatch))
    writeManifest(r, { flows: [] })
    await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        briefing = await task.prepare()
        return { kind: 'outcome', outcome: { kind: 'retired', attempts: 1, lastEvidence: 'briefing only' } }
      }),
    })
    expect(briefing).toContain('PRIOR FLAG')
    expect(briefing).toContain('rejected scenario: the rejected scenario')
    expect(briefing).toContain(`why it was rejected: ${mismatch}`)
  }, 60_000)

  it('a FAILED worker session keeps the taint — the cache entry is still poisoned', async () => {
    const r = seed()
    writeGuardAutoResolutions(r, taintedLedger('the prior rejection'))
    await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: flowWorkerSessionOf(async () => ({ kind: 'failed', reason: 'the transport died' })),
    })
    expect(readGuardAutoResolutions(r).tainted[KEY]).toMatchObject({ mismatch: 'the prior rejection' })
  })

  it('a BLOCKED outcome clears the taint too — the worker answered honestly', async () => {
    const r = seed()
    writeGuardAutoResolutions(r, taintedLedger('the prior rejection'))
    await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: submitWorkerSessions(() => ({ blocked: [{ order: 1, capability: 'a live database' }] })),
    })
    expect(readGuardAutoResolutions(r).tainted[KEY]).toBeUndefined()
  })

  it('end-to-end: a fidelity rejection taints, and the NEXT generate briefs the worker with the mismatch', async () => {
    const r = seed()
    const mismatch = 'the scenario asserts an exit code the section never states'

    // Run 1 — the fidelity judge rejects, and the worker retires.
    await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        await task.submitScenario(
          `title: always broken\nsteps:\n  - run: ["--version"]\n    expect:\n      exit: 0\n    milestone: 1\n`,
          [],
          async () => ({ kind: 'flagged', mismatch, confidence: 'low' }),
        )
        return { kind: 'outcome', outcome: { kind: 'retired', attempts: 1, lastEvidence: mismatch } }
      }),
    })
    expect(readGuardAutoResolutions(r).tainted[KEY]).toMatchObject({ mismatch })

    // Run 2 — the taint rides the briefing as the prior flag.
    let briefing = ''
    await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        briefing = await task.prepare()
        return { kind: 'outcome', outcome: { kind: 'retired', attempts: 1, lastEvidence: 'still stuck' } }
      }),
    })
    expect(briefing).toContain('PRIOR FLAG')
    expect(briefing).toContain(`why it was rejected: ${mismatch}`)
  }, 60_000)
})
