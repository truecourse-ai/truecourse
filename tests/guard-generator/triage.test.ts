/**
 * The WORKER's own failing diagnosis — what replaced the triage stage. A session
 * that cannot make its scenario pass settles it FAILING with a verdict attached,
 * and that verdict is the diagnosis the pipeline carries: onto the birth finding,
 * onto the manifest scenario (the durable record), and nowhere else.
 *
 * The confirmation round is the gate of record: a settled-FAILING candidate runs
 * ONCE more in a fresh sandbox the session never touched. Still failing ⇒ the test
 * commits red with its diagnosis. Passing ⇒ the diagnosis dies with the failure it
 * explained and the test commits green. Either way the flow SETTLES — a committed
 * test is a decision surface, so the next generate is a no-op.
 */
import { describe, it, expect, afterEach } from 'vitest'
import type { GuardTriage } from '@truecourse/shared'
import { defaultGuardExecutor, readManifest, type GuardExecutor } from '@truecourse/guard-runner'
import type { LlmTurnRequest } from '@truecourse/shared/llm'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  extractBy,
  workerTurnBy,
  runGenerate,
  WORKER_FAILING,
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

/** A worker's own read of its failing run: the doc, not the code, is stale. */
const DOC_DRIFT: GuardTriage = {
  verdict: 'doc-drift',
  confidence: 'medium',
  brief: 'The section still promises exit 0; the command has exited 7 since the retry rework.',
  recommendation: 'Update the section to document the non-zero exit, or restore exit 0.',
}

/**
 * The real executor, except that every invocation AFTER the worker's own
 * in-session run reports the scenario green — the flaky case the confirmation
 * round exists to arbitrate, where a fresh sandbox disagrees with the session's.
 */
function greenAfterTheSession(sink: { runs: number }): GuardExecutor {
  return async (input) => {
    sink.runs++
    const report = await defaultGuardExecutor(input)
    if (sink.runs === 1 || report.status !== 'ok') return report
    const scenarios = report.latest.scenarios.map((s) => {
      if (s.outcome !== 'fail') return s
      const { failure: _failure, failedMilestone: _failedMilestone, ...rest } = s
      return { ...rest, outcome: 'pass' as const }
    })
    return {
      ...report,
      latest: {
        ...report.latest,
        scenarios,
        summary: {
          ...report.latest.summary,
          pass: scenarios.filter((s) => s.outcome === 'pass').length,
          fail: scenarios.filter((s) => s.outcome === 'fail').length,
        },
      },
    }
  }
}

describe('the worker diagnosis — a failing settle carries its own verdict', () => {
  it('the settle diagnosis rides the committed failing test AND the manifest', async () => {
    const r = seed()
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      turnFn: workerTurnBy({
        version: { scenario: raw('always broken', FAILING_STEPS), failing: DOC_DRIFT },
      }),
    })

    expect(res.written).toMatchObject([{ id: 'version.cli.1', status: 'failing' }])
    // The verdict is on the TEST, not the flow — the identity travels with the finding.
    expect(res.birthFindings).toHaveLength(1)
    expect(res.birthFindings[0].triage).toEqual(DOC_DRIFT)
    expect(res.birthFindings[0].scenarioId).toBe('version.cli.1')
    expect(res.birthFindings[0].committed).toBe(true)

    // The DURABLE record: the manifest scenario carries the same diagnosis, so it
    // travels with the corpus and survives every no-op generate.
    const manifest = readManifest(r)!.flows.find((f) => f.flowId === 'version')!
    expect(manifest.scenarios[0].diagnosis).toMatchObject({
      title: 'always broken',
      triage: DOC_DRIFT,
      file: res.written[0].file,
    })

    // B6 arithmetic: every failing written test has exactly one committed row.
    const committedRows = res.birthFindings.filter((f) => f.kind !== 'fidelity' && f.committed)
    expect(committedRows).toHaveLength(res.written.filter((w) => w.status === 'failing').length)
  })

  it('a bare failing scenario settles with the worker canned verdict — never untriaged', async () => {
    const r = seed()
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      turnFn: workerTurnBy({ version: raw('always broken', FAILING_STEPS) }),
    })

    expect(res.written).toMatchObject([{ id: 'version.cli.1', status: 'failing' }])
    expect(res.birthFindings[0].triage).toEqual(WORKER_FAILING)
    expect(readManifest(r)!.flows[0].scenarios[0].diagnosis).toMatchObject({ triage: WORKER_FAILING })
  })
})

describe('the confirmation round is the gate of record', () => {
  it('a failing settle whose confirmation PASSES commits green, diagnosis dropped', async () => {
    const r = seed()
    const sink = { runs: 0 }
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      turnFn: workerTurnBy({
        version: { scenario: raw('always broken', FAILING_STEPS), failing: DOC_DRIFT },
      }),
      executor: greenAfterTheSession(sink),
    })

    // The session ran it once and read a failure; the confirmation batch ran it again.
    expect(sink.runs).toBe(2)
    expect(res.written).toMatchObject([{ id: 'version.cli.1', status: 'passing' }])
    // The confirmation is the evidence of record: no failure survives, so no
    // diagnosis explains one.
    expect(res.birthFindings).toEqual([])
    expect(readManifest(r)!.flows[0].scenarios[0].diagnosis).toBeUndefined()
  })

  it('a committed failing test SETTLES its flow — the next generate spends nothing', async () => {
    const r = seed()
    const first = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      turnFn: workerTurnBy({
        version: { scenario: raw('always broken', FAILING_STEPS), failing: DOC_DRIFT },
      }),
    })
    expect(first.written).toHaveLength(1)
    expect(readManifest(r)!.flows[0].generationInputsHash).not.toBeNull()

    const turns: LlmTurnRequest[] = []
    const second = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      turnFn: workerTurnBy(
        { version: { scenario: raw('always broken', FAILING_STEPS), failing: DOC_DRIFT } },
        (req) => turns.push(req),
      ),
    })

    expect(turns).toEqual([])
    expect(second.written).toEqual([])
    expect(second.flows.skipped).toBe(1)
    // The committed red test and its diagnosis survive the no-op untouched.
    expect(readManifest(r)!.flows[0].scenarios).toMatchObject([
      { id: 'version.cli.1', status: 'failing', diagnosis: { triage: DOC_DRIFT } },
    ])
  })
})
