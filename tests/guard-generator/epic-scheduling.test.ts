/**
 * Epic DAG scheduling: a flow with a non-empty `composedOf` is an EPIC and
 * authors in a SECOND wave, after every member task settled. Its user prompt
 * carries the settled members' scenarios verbatim (read-only); an unsettled
 * member is listed with its state instead — and the members' own outcomes are
 * never changed by the epic.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { readManifest } from '@truecourse/guard-runner'
import type { FlowsEpicRunner } from '@truecourse/guard-generator'
import type { LlmTurnRequest } from '@truecourse/shared/llm'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  extractBy,
  flowPerClaim,
  runGenerate,
  workerTurnBy,
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

/** Two docs in two AREAS (the epic pass only runs across areas), one claim each. */
function seedTwoAreas(): string {
  const r = repo()
  writeRecipe(r)
  writeCorpus(r, [
    { ref: 'docs/a.md', areaTags: ['area/alpha'] },
    { ref: 'docs/b.md', areaTags: ['area/beta'] },
  ])
  writeDoc(r, 'docs/a.md', '## alpha\n`relkit --version` exits 0.\n')
  writeDoc(r, 'docs/b.md', '## beta\n`relkit boom` exits 7.\n')
  return r
}

const extract = extractBy({
  alpha: [{ claim: 'the version prints', driver: 'cli' }],
  beta: [{ claim: 'boom exits 7', driver: 'cli' }],
})

/** An epic pass that chains EVERY digest it is shown into one epic flow. */
const chainAll: FlowsEpicRunner = async ({ digests }) => ({
  epics: [
    {
      title: 'alpha then beta',
      goal: 'walk both areas end to end',
      composedOf: digests.map((d) => d.ref),
      milestones: digests.flatMap((d) => d.milestones),
    },
  ],
})

describe('generateGuards — epic DAG scheduling (two waves)', () => {
  it('members settle first; the epic prompt carries their scenarios read-only', async () => {
    const r = seedTwoAreas()
    const openings: { flowId: string; text: string }[] = []
    const onTurn = (req: LlmTurnRequest): void => {
      if (req.messages.length === 1) openings.push({ flowId: req.subject ?? '', text: req.messages[0].text })
    }

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extract,
      flowsRunner: flowPerClaim(),
      flowsEpicRunner: chainAll,
      concurrency: 4,
      turnFn: workerTurnBy(
        {
          alpha: raw('alpha member scenario', PASSING_STEPS),
          beta: raw('beta member scenario', PASSING_STEPS),
          'alpha-then-beta': raw('the epic walks both', PASSING_STEPS),
        },
        onTurn,
      ),
    })

    expect(res.status).toBe('ok')
    expect(res.errors).toEqual([])
    // The epic's session OPENED after both members' sessions — wave two.
    expect(openings.map((o) => o.flowId).slice(0, 2).sort()).toEqual(['alpha', 'beta'])
    expect(openings[openings.length - 1].flowId).toBe('alpha-then-beta')

    // The epic prompt carries the settled members' scenarios verbatim, read-only.
    const epic = openings.find((o) => o.flowId === 'alpha-then-beta')!.text
    expect(epic).toContain('MEMBER SCENARIOS (settled, read-only)')
    expect(epic).toContain('--- member alpha (settled)')
    expect(epic).toContain('--- member beta (settled)')
    expect(epic).toContain('title: alpha member scenario')
    expect(epic).toContain('title: beta member scenario')
    // A member prompt never carries the block (it is not an epic).
    expect(openings.find((o) => o.flowId === 'alpha')!.text).not.toContain('MEMBER SCENARIOS')

    // All three flows committed their own scenario; the epic changed nothing
    // about the members' outcomes.
    expect(res.written.map((w) => w.flowId).sort()).toEqual(['alpha', 'alpha-then-beta', 'beta'])
    expect(res.written.every((w) => w.status === 'passing')).toBe(true)
    const flows = new Map(readManifest(r)!.flows.map((f) => [f.flowId, f]))
    expect(flows.get('alpha')!.scenarios).toEqual([{ id: 'alpha.cli.1', surface: 'cli', status: 'passing' }])
    expect(flows.get('beta')!.scenarios).toEqual([{ id: 'beta.cli.1', surface: 'cli', status: 'passing' }])
  }, 60_000)

  it('an UNSETTLED member is listed with its state, and its outcome survives the epic untouched', async () => {
    const r = seedTwoAreas()
    const openings: { flowId: string; text: string }[] = []

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extract,
      flowsRunner: flowPerClaim(),
      flowsEpicRunner: chainAll,
      concurrency: 4,
      turnFn: workerTurnBy(
        {
          alpha: raw('alpha member scenario', PASSING_STEPS),
          beta: { blockedOn: ['anthropic'] },
          'alpha-then-beta': { blockedOn: ['anthropic'] },
        },
        (req) => {
          if (req.messages.length === 1) openings.push({ flowId: req.subject ?? '', text: req.messages[0].text })
        },
      ),
    })

    expect(res.status).toBe('ok')
    const epic = openings.find((o) => o.flowId === 'alpha-then-beta')!.text
    // The settled member rides in as YAML; the blocked one as its state line.
    expect(epic).toContain('--- member alpha (settled)')
    expect(epic).toContain('--- member beta: blocked on anthropic')
    expect(epic).not.toContain('--- member beta (settled)')

    // The members' outcomes are exactly what their own sessions settled — the
    // epic (itself blocked here) changed neither.
    expect(res.written.map((w) => w.flowId)).toEqual(['alpha'])
    const betaGap = res.coverageGaps.find((g) => g.flowId === 'beta')!
    expect(betaGap.kind).toBe('blocked-on')
    expect(betaGap.reason).toContain('anthropic')
  }, 60_000)
})
