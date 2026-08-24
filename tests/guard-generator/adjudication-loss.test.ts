/**
 * What happens to a test when its ADJUDICATION call is lost. Fidelity is the one
 * adjudication stage left: it judges work that already exists, auditing a green
 * settle the worker's session just produced. A lost call therefore costs a
 * VERDICT, never the work — but the verdict is the whole point of the stage
 * (fidelity discarded 5 of 22 greens as unfaithful in one field run), so a review
 * that dies silently leaves exactly the suspect class unjudged.
 *
 * Two guarantees here. A call that THREW is retried once — it never answered, so
 * there is nothing to correct and asking again is the entire fix. And a loss that
 * survives the retry is recorded AGAINST THE TEST: the error row carries the
 * scenario, flow and surface it was judging, and the stage tally names the same
 * subject, so "2 of 22 reviews failed" never again means log forensics to find out
 * which two tests shipped unjudged.
 */
import { describe, it, expect, afterEach } from 'vitest'
import type { FidelityRunner } from '@truecourse/guard-generator'
import { readManifest } from '@truecourse/guard-runner'
import type { LlmTransport } from '@truecourse/shared/llm'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  extractBy,
  workerTurnBy,
  faithfulReviewer,
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
const DOC_CONTENT = ['## version', '`relkit --version` prints the version and exits 0.'].join('\n')
const OTHER_DOC = 'docs/other.md'
const OTHER_CONTENT = ['## help', '`relkit --version` also answers here and exits 0.'].join('\n')

function seed(...docs: { ref: string; content: string }[]): string {
  const r = repo()
  writeRecipe(r)
  writeCorpus(r, docs.map((d) => ({ ref: d.ref })))
  for (const d of docs) writeDoc(r, d.ref, d.content)
  return r
}

const ONE_DOC = [{ ref: DOC, content: DOC_CONTENT }]

/** A transport that throws for `stages` and answers `{}` otherwise. */
function failing(stages: string[], message: string): LlmTransport {
  return async (req) => {
    if (stages.includes(req.stage ?? '')) throw new Error(message)
    return '{}'
  }
}

const TIMEOUT = 'claude timed out after 600000ms'

describe('a timed-out adjudication call is retried once', () => {
  it('fidelity: the retry lands, the green is reviewed, and nothing is reported', async () => {
    const r = seed(...ONE_DOC)
    let calls = 0
    const flaky: FidelityRunner = async () => {
      if (++calls === 1) throw new Error(TIMEOUT)
      return { verdict: 'faithful' }
    }

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      turnFn: workerTurnBy({ version: raw('prints the version', PASSING_STEPS) }),
      fidelityRunner: flaky,
    })

    expect(calls).toBe(2)
    expect(res.status).toBe('ok')
    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
    // A recovered review is a reviewed test: no error row, no unadjudicated stage.
    expect(res.errors).toEqual([])
    expect(res.unadjudicated).toEqual([])
  })

  // The retry is a fresh CALL, not a replay: nothing is cached for a failure, so a
  // stage that keeps failing keeps paying for real attempts rather than reading a
  // cached "it failed" back and skipping the model.
  it('a retried loss caches nothing — the next generate really calls again', async () => {
    const r = seed(...ONE_DOC)
    let first = 0
    await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      turnFn: workerTurnBy({ version: raw('prints the version', PASSING_STEPS) }),
      fidelityRunner: async () => {
        first++
        throw new Error(TIMEOUT)
      },
    })
    expect(first).toBe(2)

    let second = 0
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      turnFn: workerTurnBy({ version: raw('prints the version', PASSING_STEPS) }),
      fidelityRunner: faithfulReviewer(() => second++),
    })
    expect(second).toBe(1)
    expect(res.errors).toEqual([])
  })
})

describe('a lost adjudication call names the test it was judging', () => {
  it('fidelity: the green is kept, and the error row + tally both name the scenario', async () => {
    const r = seed(...ONE_DOC)

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      turnFn: workerTurnBy({ version: raw('prints the version', PASSING_STEPS) }),
      // No injected reviewer — the stage spawns on the transport, as production does.
      fidelityRunner: undefined,
      transport: failing(['guard.fidelity'], TIMEOUT),
    })

    expect(res.status).toBe('ok')
    // The stage lost every call, so the corpus ships and says it is unadjudicated.
    expect(res.written.map((w) => w.id)).toEqual(['version.cli.1'])
    expect(res.unadjudicated).toEqual([{ stage: 'guard.fidelity', affected: 1 }])
    // And the flow does NOT settle, so the next generate reviews it for real.
    expect(readManifest(r)!.flows.find((f) => f.flowId === 'version')!.generationInputsHash).toBeNull()

    expect(res.errors).toHaveLength(1)
    expect(res.errors[0]).toMatchObject({
      kind: 'fidelity',
      flowId: 'version',
      surface: 'cli',
      scenarioId: 'version.cli.1',
      doc: DOC,
    })
    expect(res.errors[0].message).toContain(TIMEOUT)

    const tally = res.llmFailures.find((f) => f.stage === 'guard.fidelity')!
    // One review, two attempts (the call plus its retry), both lost.
    expect(tally).toMatchObject({ attempts: 2, failures: 2, subjects: ['version.cli.1'] })
  })

  // The field case: a PARTIAL loss, where the stage is healthy overall. The per-call
  // fail-soft is unchanged (the unreviewed candidate is dropped and its flow left
  // unsettled, so the next generate re-reviews it) — what changes is that the row
  // says WHICH test that was, instead of a section attribution shared by every flow.
  //
  // The review now runs IN-LOOP, inside each flow's worker session, and the blind
  // check reads the tally at review time — so the flows are authored ONE AT A TIME
  // here to fix which review lands first. Concurrently, "healthy overall" would be
  // a race: `help` judged before `version` ever called would read a stage that has
  // lost every call so far.
  it('one review of two lost: the healthy flow is written, the lost one is named', async () => {
    const r = seed({ ref: DOC, content: DOC_CONTENT }, { ref: OTHER_DOC, content: OTHER_CONTENT })
    const halfDown: LlmTransport = async (req) => {
      if (req.stage !== 'guard.fidelity') return '{}'
      if (req.subject?.startsWith('help')) throw new Error(TIMEOUT)
      return JSON.stringify({ verdict: 'faithful' })
    }

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      fidelityRunner: undefined,
      transport: halfDown,
      concurrency: 1,
    })

    expect(res.status).toBe('ok')
    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
    // Not systemic — one review landed — so the run is NOT reported unadjudicated.
    expect(res.unadjudicated).toEqual([])
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0]).toMatchObject({ kind: 'fidelity', flowId: 'help', scenarioId: 'help.cli.1' })
    const tally = res.llmFailures.find((f) => f.stage === 'guard.fidelity')!
    expect(tally.subjects).toEqual(['help.cli.1'])
  })

  // The TOTAL loss over more than one test: every candidate persists unreviewed
  // rather than the run throwing away its whole authoring spend, the count of what
  // shipped unjudged is reported, and every affected flow stays work.
  it('the stage losing every review ships both tests unreviewed and unsettled', async () => {
    const r = seed({ ref: DOC, content: DOC_CONTENT }, { ref: OTHER_DOC, content: OTHER_CONTENT })

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      fidelityRunner: undefined,
      transport: failing(['guard.fidelity'], TIMEOUT),
    })

    expect(res.status).toBe('ok')
    expect(res.written.map((w) => w.id).sort()).toEqual(['help.cli.1', 'version.cli.1'])
    expect(res.unadjudicated).toEqual([{ stage: 'guard.fidelity', affected: 2 }])
    expect(res.errors.map((e) => e.scenarioId).sort()).toEqual(['help.cli.1', 'version.cli.1'])
    expect(readManifest(r)!.flows.every((f) => f.generationInputsHash === null)).toBe(true)
  })
})
