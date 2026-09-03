/**
 * THE FIDELITY SELF-HEAL, in-loop (plan 04 step 18). A green candidate the
 * judge flags at HIGH confidence is the system's own mess: the flag comes back
 * to the STILL-OPEN worker as the submit error, the worker revises and submits
 * again, and no human task is created. There is no separate re-author round any
 * more — the ledger bump (source `fidelity`) and the escalation budget are the
 * mechanics that survive.
 *
 * A second flag of ANY confidence is a REJECTION: one heal per flow per run.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { autoResolutionKey } from '@truecourse/shared'
import { readGuardAutoResolutions, writeGuardAutoResolutions, loadScenarios } from '@truecourse/guard-runner'
import type { FlowWorkerSessionResult, FlowWorkerTask, WorkerFidelityJudge } from '@truecourse/guard-generator'
import {
  FAILING_STEPS,
  PASSING_STEPS,
  acceptedSha,
  extractSessionBy,
  flowWorkerSessionOf,
  judgeBy,
  makeTempRepo,
  observedActual,
  observedStep,
  raw,
  rmrf,
  runGenerate,
  scenarioYaml,
  stampMilestones,
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
const MISMATCH = 'asserts exit 0 where the claim quotes the exact version line'

const draft = (title: string, steps = PASSING_STEPS): string =>
  scenarioYaml(stampMilestones(raw(title, steps), 1))

/**
 * A worker that submits `weak`, and — when the engine bounces it — revises to
 * `strong` and submits that. Exactly the loop the worker prompt describes.
 */
function healingWorker(
  judge: WorkerFidelityJudge,
  strong: { title: string; steps?: typeof PASSING_STEPS; declaresRed?: boolean } = { title: 'strong' },
) {
  const reports: { content: string; isError?: boolean }[] = []
  const seam = flowWorkerSessionOf(async (task: FlowWorkerTask): Promise<FlowWorkerSessionResult> => {
    const first = await task.submitScenario(draft('weak'), [], judge)
    reports.push(first)
    const firstSha = acceptedSha(first)
    if (firstSha) return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: firstSha, expectedReds: [] } }

    const yamlText = draft(strong.title, strong.steps ?? PASSING_STEPS)
    if (strong.declaresRed) {
      const probe = await task.submitScenario(yamlText, [], judge)
      const reds = [
        {
          step: observedStep(probe),
          predictedActual: observedActual(probe),
          verdict: 'code-drift' as const,
          brief: 'the doc and the code disagree',
        },
      ]
      const declared = await task.submitScenario(yamlText, reds, judge)
      reports.push(declared)
      const sha = acceptedSha(declared)
      if (sha) return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: sha, expectedReds: reds } }
      return { kind: 'outcome', outcome: { kind: 'retired', attempts: 2, lastEvidence: declared.content } }
    }

    const second = await task.submitScenario(yamlText, [], judge)
    reports.push(second)
    const sha = acceptedSha(second)
    if (sha) return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: sha, expectedReds: [] } }
    return { kind: 'outcome', outcome: { kind: 'retired', attempts: 2, lastEvidence: second.content } }
  })
  return { seam, reports }
}

describe('fidelity self-heal', () => {
  it('a HIGH flag comes back as a REVISE error; the faithful replacement commits clean', async () => {
    const r = seed()
    let reviews = 0
    const { seam, reports } = healingWorker(
      judgeBy({ weak: { mismatch: MISMATCH, confidence: 'high' } }, () => reviews++),
    )
    const res = await runGenerate({ repoRoot: r, extractSession: versionCliBgUntestable, flowWorkerSession: seam })

    // The flag was an in-loop correction, not a separate round.
    expect(reports[0].isError).toBe(true)
    expect(reports[0].content).toContain('high confidence')
    expect(reports[0].content).toContain('Revise')
    expect(reports[1].isError).toBeUndefined()
    // Both the discarded candidate and its replacement were reviewed.
    expect(reviews).toBe(2)

    // The replacement committed under the flow's stable id; no finding, no task.
    expect(res.written).toMatchObject([{ id: 'version', title: 'strong', status: 'passing' }])
    expect(res.birthFindings).toEqual([])
    expect(loadScenarios(r).scenarios.map((s) => s.id)).toEqual(['version'])
    expect(res.flows).toMatchObject({ settled: 1, unsettled: 0 })

    // Converged: the budget cleared, nothing tainted. A taint means "the flow
    // ended REJECTED" — a flow that healed did not, and a stale taint costs the
    // next generate a needless cache bypass and a full worker session.
    const ledger = readGuardAutoResolutions(r)
    expect(ledger.entries[KEY]).toBeUndefined()
    expect(ledger.tainted[KEY]).toBeUndefined()
  }, 60_000)

  it('a replacement flagged AGAIN (any confidence) is a rejection — one heal per flow per run', async () => {
    const r = seed()
    const { seam, reports } = healingWorker(
      judgeBy({
        weak: { mismatch: MISMATCH, confidence: 'high' },
        strong: { mismatch: 'still weak', confidence: 'low' },
      }),
    )
    const res = await runGenerate({ repoRoot: r, extractSession: versionCliBgUntestable, flowWorkerSession: seam })

    expect(reports[1].isError).toBe(true)
    expect(reports[1].content).toContain('REJECTED')
    expect(res.written).toEqual([])
    expect(res.birthFindings).toMatchObject([{ kind: 'fidelity', title: 'strong', actual: 'still weak' }])
    expect(res.flows).toMatchObject({ settled: 0, unsettled: 1 })
    // Non-converged: counted AND tainted for the next generate.
    const ledger = readGuardAutoResolutions(r)
    expect(ledger.entries[KEY]).toMatchObject({ count: 1, source: 'fidelity' })
    expect(ledger.tainted[KEY]).toBeTruthy()
  }, 60_000)

  it('a replacement that fails its confirmation routes like any red — declared, then committed', async () => {
    const r = seed()
    const { seam } = healingWorker(judgeBy({ weak: { mismatch: MISMATCH, confidence: 'high' } }), {
      title: 'strong',
      steps: FAILING_STEPS,
      declaresRed: true,
    })
    const res = await runGenerate({ repoRoot: r, extractSession: versionCliBgUntestable, flowWorkerSession: seam })

    expect(res.written).toMatchObject([{ title: 'strong', status: 'failing' }])
    expect(res.birthFindings).toMatchObject([{ title: 'strong', committed: true }])
    // The acceptance cleared the pending fidelity finding — one record, not two.
    expect(res.birthFindings.filter((f) => f.kind === 'fidelity')).toEqual([])
  }, 60_000)

  it('a MEDIUM flag never self-heals — a plain rejection, tainted, no ledger count', async () => {
    const r = seed()
    let submits = 0
    const res = await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: submitWorkerSessions(() => raw('weak', PASSING_STEPS), {
        judge: judgeBy({ weak: { mismatch: MISMATCH, confidence: 'medium' } }),
        onSubmit: () => submits++,
        onRefusal: 'retire',
      }),
    })

    expect(submits).toBe(1) // no in-loop heal was offered
    expect(res.birthFindings).toMatchObject([{ kind: 'fidelity' }])
    expect(res.birthFindings[0].autoResolveEscalation).toBeUndefined()
    const ledger = readGuardAutoResolutions(r)
    expect(ledger.entries[KEY]).toBeUndefined()
    expect(ledger.tainted[KEY]).toBeTruthy()
  }, 60_000)

  it('past the budget a HIGH flag escalates instead of healing — the safety valve', async () => {
    const r = seed()
    writeGuardAutoResolutions(r, {
      version: 1,
      entries: { [KEY]: { count: 2, source: 'fidelity', updatedAt: '2026-07-01T00:00:00Z' } },
      tainted: {},
    })
    const reports: { content: string; isError?: boolean }[] = []
    const res = await runGenerate({
      repoRoot: r,
      extractSession: versionCliBgUntestable,
      flowWorkerSession: submitWorkerSessions(() => raw('weak', PASSING_STEPS), {
        judge: judgeBy({ weak: { mismatch: MISMATCH, confidence: 'high' } }),
        onSubmit: (_t, report) => reports.push(report),
        onRefusal: 'retire',
      }),
    })

    expect(reports[0].content).toContain('REJECTED') // never "Revise"
    expect(res.birthFindings).toMatchObject([
      { kind: 'fidelity', autoResolveEscalation: { count: 2, source: 'fidelity' } },
    ])
  }, 60_000)
})
