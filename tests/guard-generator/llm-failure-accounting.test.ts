/**
 * Total-vs-partial LLM failure accounting in generateGuards(). A stage whose
 * every call was lost used to report `status: 'ok'` with `written: []` — a run
 * that verified nothing, indistinguishable from a clean no-op, while the persist
 * pass quietly rewrote the corpus with the outage's emptiness (orphaning every
 * committed flow, deleting every re-authored flow's prior scenarios).
 *
 * Now: extraction, flow synthesis, matching and the flow workers — the stages
 * whose loss REWRITES what lands on disk — return `llm-failed` and touch
 * nothing, whether the work was lost by transport or answered with output that
 * failed validation. FIDELITY, the adjudication stage, is carved OUT of that
 * rule: it gates verdicts about content birth already validated, so losing it
 * costs annotation, not correctness — the run ships its corpus and records the
 * stage as unadjudicated. Losing SOME work keeps every stage's fail-soft
 * behaviour and reports the counts; a run that loses nothing is healthy.
 *
 * WHAT MOVED (plan 04): extraction, flow synthesis, authoring and fidelity are
 * agent SESSIONS now, and a session never touches the one-shot transport — so
 * their losses arrive as `GuardSessionSummary` fields on the seam's answer, and
 * are tallied under the SESSION KIND (`guard-generate.extract`, …) rather than
 * a stage id. Only `guard.match` and `guard.recipe` still lose CALLS. The
 * TRIAGE stage is gone entirely (step 20), so its cases went with it.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { generateGuards, type ExtractResult, type FlowsAreaSessionSeam } from '@truecourse/guard-generator'
import { manifestPath, readManifest, writeManifest, scenariosDir } from '@truecourse/guard-runner'
import { type GuardScenario } from '@truecourse/shared'
import type { LlmTransport } from '@truecourse/shared/llm'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  writeScenarioFile,
  bindsFor,
  raw,
  extractSessionBy,
  extractSessionOf,
  flowsAreaSessionOf,
  flowStageSeams,
  flowWorkerSessionOf,
  runGenerate,
  sessionSummary,
  submitWorkerSessions,
  EXTRACT_KIND,
  FLOWS_KIND,
  WORKER_KIND,
  PASSING_STEPS,
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

/** Every doc's extraction lost, transport-class — the systemic-loss shape. */
function extractionLost(reason: string, docs: string[]): ReturnType<typeof extractSessionOf> {
  return extractSessionOf(
    new Map<string, ExtractResult>(docs.map((d) => [d, { ok: false, reason: `extraction session failed: ${reason}` }])),
    { ran: docs.length, failed: docs.length, allTransport: true, firstError: reason },
  )
}

/** A worker seam that lost every session, transport-class. */
function workersLost(reason: string, count = 1): ReturnType<typeof flowWorkerSessionOf> {
  return flowWorkerSessionOf(async () => ({ kind: 'failed', reason }), {
    summary: { failed: count, allTransport: true, firstError: reason },
  })
}

/** Commit one passing scenario + its settled manifest entry, and snapshot both. */
function commitPriorFlow(r: string): { manifest: string; scenario: string; file: string } {
  const binds = bindsFor(r, DOC, 'version')
  const scenario: GuardScenario = {
    id: 'version',
    title: 'prints the version',
    driver: 'cli',
    binds,
    steps: PASSING_STEPS,
  }
  writeScenarioFile(r, 'cli/version.yaml', scenario)
  writeManifest(r, {
    flows: [
      {
        flowId: 'version',
        flowFingerprint: 'fp-version',
        bindings: [{ doc: DOC, anchor: 'version', fingerprint: binds.fingerprint }],
        scenarios: [{ id: 'version', drivers: ['cli'], status: 'passing' }],
        interfaces: [],
        // A null hash re-detects the flow as work, so the run really does re-author
        // it — and really would delete its file on a zero-survivor pass.
        generationInputsHash: null,
        gaps: [],
      },
    ],
  })
  const file = path.join(scenariosDir(r), 'cli/version.yaml')
  return {
    manifest: fs.readFileSync(manifestPath(r), 'utf-8'),
    scenario: fs.readFileSync(file, 'utf-8'),
    file,
  }
}

describe('extraction losing every session aborts the run', () => {
  it('returns llm-failed naming the session kind and the affected documents, writing no manifest', async () => {
    const r = seed(...ONE_DOC)

    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractionLost("Invalid schema for response_format: Missing 'extension'.", [DOC]),
    })

    expect(res.status).toBe('llm-failed')
    expect(res.reason).toContain(EXTRACT_KIND)
    expect(res.reason).toContain("Missing 'extension'")
    expect(res.reason).toContain('the committed scenarios and manifest are unchanged')
    expect(res.written).toEqual([])
    // The affected document is NAMED, not just counted.
    expect(res.extractionFailures.map((f) => f.doc)).toEqual([DOC])
    expect(res.llmFailures).toEqual([
      {
        stage: EXTRACT_KIND,
        attempts: 1,
        failures: 1,
        firstError: "Invalid schema for response_format: Missing 'extension'.",
      },
    ])
    // A healthy-looking empty manifest is exactly what made this invisible.
    expect(fs.existsSync(manifestPath(r))).toBe(false)
  })

  it('leaves a prior manifest and the scenario it binds byte-identical', async () => {
    const r = seed(...ONE_DOC)
    const prior = commitPriorFlow(r)

    const res = await runGenerate({ repoRoot: r, extractSession: extractionLost('claude exited 1', [DOC]) })

    expect(res.status).toBe('llm-failed')
    expect(fs.readFileSync(manifestPath(r), 'utf-8')).toBe(prior.manifest)
    expect(fs.readFileSync(prior.file, 'utf-8')).toBe(prior.scenario)
  })
})

describe('flow synthesis losing every session aborts before flows.json is rewritten', () => {
  const flowsPath = (r: string): string => path.join(scenariosDir(r), 'flows.json')

  it('aborts on a transport wipeout, leaving the committed flow corpus untouched', async () => {
    const r = seed(...ONE_DOC)
    // A committed corpus the abort must not clobber.
    fs.mkdirSync(scenariosDir(r), { recursive: true })
    fs.writeFileSync(flowsPath(r), '{"version":1,"generatedAt":"2026-01-01T00:00:00Z","flows":[],"noFlowClaims":[]}')
    const before = fs.readFileSync(flowsPath(r), 'utf-8')

    const lost: FlowsAreaSessionSeam = async ({ areas }) => ({
      byArea: new Map(areas.map((a) => [a.areaId, { ok: false as const, reason: 'flows session failed: expired login' }])),
      summary: sessionSummary(FLOWS_KIND, {
        ran: areas.length,
        failed: areas.length,
        allTransport: true,
        firstError: 'expired login',
      }),
    })

    const res = await generateGuards({ ...flowStageSeams(r), repoRoot: r, flowsAreaSession: lost })

    expect(res.status).toBe('llm-failed')
    expect(res.reason).toContain(FLOWS_KIND)
    expect(res.llmFailures.find((f) => f.stage === FLOWS_KIND)?.failures).toBeGreaterThan(0)
    expect(fs.readFileSync(flowsPath(r), 'utf-8')).toBe(before)
    expect(fs.existsSync(manifestPath(r))).toBe(false)
  })

  it('aborts when every area ANSWERED unusably — no transport failure, the reason states the loss', async () => {
    const r = seed(...ONE_DOC)

    // Sessions COMPLETED, and every value failed the fold's re-validation.
    const res = await runGenerate({
      repoRoot: r,
      flowsAreaSession: flowsAreaSessionOf(() => ({
        flows: [{ title: 'Invented', goal: 'g', milestones: [{ order: 1, doc: DOC, anchor: 'version', claimTitle: 'nothing like a claim' }] }],
        noFlowClaims: [],
      })),
    })

    expect(res.status).toBe('llm-failed')
    expect(res.reason).toContain('guard.flows')
    expect(res.reason).toContain('unusable')
    // Nothing failed, so no tally records it — the reason is the record.
    expect(res.llmFailures).toEqual([])
    // The corpus a wipeout would have written is never written at all.
    expect(fs.existsSync(flowsPath(r))).toBe(false)
  })
})

describe('matching losing every call aborts before a flow is re-authored', () => {
  // Match is one of the TWO stages still on the one-shot transport, so it is
  // still a CALL tally rather than a session summary.
  it('keeps the prior scenarios the settle pass would have deleted', async () => {
    const r = seed(...ONE_DOC)
    const prior = commitPriorFlow(r)

    const res = await generateGuards({
      ...flowStageSeams(r),
      repoRoot: r,
      matchRunner: undefined,
      transport: failing(['guard.match'], 'claude API error (api 500)'),
    })

    expect(res.status).toBe('llm-failed')
    expect(res.reason).toContain('guard.match')
    expect(res.written).toEqual([])
    expect(fs.readFileSync(manifestPath(r), 'utf-8')).toBe(prior.manifest)
    expect(fs.readFileSync(prior.file, 'utf-8')).toBe(prior.scenario)
  })
})

describe('the flow workers losing every session abort before persist', () => {
  it('aborts and keeps the prior scenarios', async () => {
    const r = seed(...ONE_DOC)
    const prior = commitPriorFlow(r)

    const res = await runGenerate({
      repoRoot: r,
      flowWorkerSession: workersLost('the provider failed (provider): expired login'),
    })

    expect(res.status).toBe('llm-failed')
    expect(res.reason).toContain(WORKER_KIND)
    expect(res.written).toEqual([])
    expect(res.llmFailures.find((f) => f.stage === WORKER_KIND)?.failures).toBeGreaterThan(0)
    // An LLM outage never deletes coverage.
    expect(fs.readFileSync(manifestPath(r), 'utf-8')).toBe(prior.manifest)
    expect(fs.readFileSync(prior.file, 'utf-8')).toBe(prior.scenario)
  })

  it('one worker of two failing is NOT fatal — the other is written', async () => {
    const r = seed({ ref: DOC, content: DOC_CONTENT }, { ref: OTHER_DOC, content: OTHER_CONTENT })

    const res = await runGenerate({
      repoRoot: r,
      flowWorkerSession: flowWorkerSessionOf(
        async (task) => {
          if (task.flowId === 'help') return { kind: 'failed', reason: 'the session ended malformed: no outcome' }
          const report = await task.submitScenario(
            (await import('js-yaml')).default.dump({
              title: 'prints the version',
              steps: PASSING_STEPS.map((s) => ({ ...s, milestone: 1 })),
            }),
            [],
            async () => ({ kind: 'faithful' }),
          )
          const sha = /under sha ([0-9a-f]{64})/.exec(report.content)?.[1]
          return sha
            ? { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: sha, expectedReds: [] } }
            : { kind: 'failed', reason: report.content }
        },
        { summary: { failed: 1, allTransport: false, firstError: 'the session ended malformed: no outcome' } },
      ),
    })

    expect(res.status).toBe('ok')
    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
    // The failed flow keeps its per-flow fail-soft settle: no hash, so it is work
    // again next generate, while its healthy sibling settled.
    const flows = readManifest(r)!.flows
    expect(flows.find((f) => f.flowId === 'help')?.generationInputsHash).toBeNull()
    expect(flows.find((f) => f.flowId === 'version')?.generationInputsHash).not.toBeNull()
    expect(res.llmFailures.find((f) => f.stage === WORKER_KIND)?.failures).toBe(1)
  })
})

describe('fidelity ships unadjudicated on a systemic loss, never aborts', () => {
  // The carve-out (plan item 88). Adjudication is the LAST thing a generate
  // does: extract, flows, match and the worker's own runs have all been paid
  // for by the time the fidelity child is dispatched. Aborting there throws
  // away a whole run's spend over verdicts ABOUT content already birth-
  // validated — annotation, not correctness. So the stage's collapse ships the
  // corpus and SAYS it was unadjudicated.
  it('persists the scenarios, reports the stage unadjudicated, and leaves the flow unsettled', async () => {
    const r = seed(...ONE_DOC)

    const res = await runGenerate({
      repoRoot: r,
      flowWorkerSession: submitWorkerSessions(() => raw('prints the version', PASSING_STEPS), {
        judge: async () => ({ kind: 'unavailable', reason: 'the provider failed (provider): claude exited 1' }),
        // Every fidelity CHILD died transport-class — the systemic-loss shape.
        fidelitySummary: sessionSummary('guard-generate.fidelity', {
          ran: 1,
          failed: 1,
          allTransport: true,
          firstError: 'the provider failed (provider): claude exited 1',
        }),
      }),
    })

    expect(res.status).toBe('ok')
    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
    expect(fs.existsSync(manifestPath(r))).toBe(true)
    // Loud, not silent: the run says which stage never adjudicated and how much
    // of the corpus shipped without it.
    expect(res.unadjudicated).toEqual([{ stage: 'guard.fidelity', affected: 1 }])
    // An unreviewed pass is NOT a rejection — nothing was withheld.
    expect(res.birthFindings).toEqual([])
    // The promise every surface makes ("re-run and it re-adjudicates") is only
    // true if the flow does NOT settle: a settled flow carries its inputs hash
    // and the next generate skips it as unchanged.
    expect(readManifest(r)!.flows.find((f) => f.flowId === 'version')!.generationInputsHash).toBeNull()
  })
})

describe('isolated failures stay fail-soft but are reported', () => {
  it('one document of two failed extraction: the other is generated and the failure is named', async () => {
    const r = seed({ ref: DOC, content: DOC_CONTENT }, { ref: OTHER_DOC, content: OTHER_CONTENT })

    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionOf(
        new Map<string, ExtractResult>([
          [
            DOC,
            {
              ok: true,
              data: {
                claims: [
                  { claim: 'prints the version', driver: 'cli', sectionAnchor: 'version', reason: 'exit code is observable' },
                ],
                untestable: [],
              },
              complete: true,
              failedViews: 0,
            },
          ],
          [OTHER_DOC, { ok: false, reason: 'extraction session failed: claude API error (api 500)' }],
        ]),
        { ran: 2, failed: 1, firstError: 'claude API error (api 500)' },
      ),
      flowWorkerSession: submitWorkerSessions(() => raw('prints the version', PASSING_STEPS)),
    })

    expect(res.status).toBe('ok')
    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
    expect(res.extractionFailures.map((f) => f.doc)).toEqual([OTHER_DOC])
    expect(res.llmFailures).toEqual([
      { stage: EXTRACT_KIND, attempts: 2, failures: 1, firstError: 'claude API error (api 500)' },
    ])
  })

  it('a run that loses nothing reports no failures', async () => {
    const r = seed(...ONE_DOC)

    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: submitWorkerSessions(() => raw('prints the version', PASSING_STEPS)),
    })

    expect(res.status).toBe('ok')
    expect(res.llmFailures).toEqual([])
    expect(res.unadjudicated).toEqual([])
    expect(readManifest(r)?.flows.map((f) => f.flowId)).toEqual(['version'])
  })

  // A committed RED needs no separate triage stage any more: the worker's own
  // confirmed `expectedReds` prediction IS the adjudication (step 20).
  it('a committed red carries the worker’s prediction, and never a triage verdict', async () => {
    const r = seed(...ONE_DOC)

    const res = await runGenerate({
      repoRoot: r,
      flowWorkerSession: submitWorkerSessions((_task) => ({
        scenario: raw('always broken', FAILING_STEPS),
        expectedReds: [{ step: 1, predictedActual: 'exit 7', verdict: 'code-drift', brief: 'the code disagrees' }],
      })),
    })

    expect(res.status).toBe('ok')
    expect(res.written.map((w) => w.status)).toEqual(['failing'])
    expect(res.unadjudicated).toEqual([])
    const entry = readManifest(r)!.flows.find((f) => f.flowId === 'version')!
    expect(entry.scenarios[0].diagnosis?.triage).toBeUndefined()
    expect(entry.scenarios[0].diagnosis?.expectedRed?.verdict).toBe('code-drift')
  })
})
