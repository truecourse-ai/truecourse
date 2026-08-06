/**
 * Total-vs-partial LLM failure accounting in generateGuards(). A stage whose every
 * call was lost used to report `status: 'ok'` with `written: []` — a run that
 * verified nothing, indistinguishable from a clean no-op, while the persist pass
 * quietly rewrote the corpus with the outage's emptiness (orphaning every committed
 * flow, deleting every re-authored flow's prior scenarios).
 *
 * Now: extraction, flow synthesis, matching and authoring — the stages whose loss
 * REWRITES what lands on disk — return `llm-failed` and touch nothing, whether the
 * calls threw or answered with output nothing could be made of. Fidelity, the
 * ADJUDICATION stage, is carved OUT of that rule: it gates verdicts about content
 * birth already validated, so losing it costs annotation, not correctness — the run
 * ships its corpus and records the stage as unadjudicated. Losing SOME calls keeps
 * every stage's fail-soft behaviour and reports the counts; a run whose stages
 * never reach the transport is healthy.
 *
 * Cli authoring is a WORKER SESSION now, and its losses are session endings, not
 * transport tallies: a session that ran out of turns, died on a turn, or never
 * produced a readable action ends `exhausted`, and the run reports it as an
 * authoring error. The turn seam is not audited, so `llmFailures` carries no
 * `guard.generate` row for a cli loss — the errors and the status are the record.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { generateGuards, type FlowsRunner } from '@truecourse/guard-generator'
import { manifestPath, readManifest, writeManifest, scenariosDir } from '@truecourse/guard-runner'
import { GUARD_FORMAT_VERSION, type GuardScenario } from '@truecourse/shared'
import type { LlmTransport, LlmTurnRequest } from '@truecourse/shared/llm'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  writeScenarioFile,
  bindsFor,
  raw,
  extractBy,
  workerTurnsBy,
  workerTurnBy,
  faithfulReviewer,
  flowStageRunners,
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

/** Commit one passing scenario + its settled manifest entry, and snapshot both. */
function commitPriorFlow(r: string): { manifest: string; scenario: string; file: string } {
  const binds = bindsFor(r, DOC, 'version')
  const scenario: GuardScenario = {
    guard: GUARD_FORMAT_VERSION,
    id: 'version.cli.1',
    title: 'prints the version',
    driver: 'cli',
    binds,
    steps: PASSING_STEPS,
  }
  writeScenarioFile(r, 'cli/version.cli.1.yaml', scenario)
  writeManifest(r, {
    version: GUARD_FORMAT_VERSION,
    flows: [
      {
        flowId: 'version',
        flowFingerprint: 'fp-version',
        bindings: [{ doc: DOC, anchor: 'version', fingerprint: binds.fingerprint }],
        scenarios: [{ id: 'version.cli.1', surface: 'cli', status: 'passing' }],
        journeys: [],
        // A null hash re-detects the flow as work, so the run really does re-author
        // it — and really would delete its file on a zero-survivor pass.
        generationInputsHash: null,
        gaps: [],
      },
    ],
  })
  const file = path.join(scenariosDir(r), 'cli/version.cli.1.yaml')
  return {
    manifest: fs.readFileSync(manifestPath(r), 'utf-8'),
    scenario: fs.readFileSync(file, 'utf-8'),
    file,
  }
}

describe('extraction losing every call aborts the run', () => {
  it('returns llm-failed with the stage reason and the affected documents, writing no manifest', async () => {
    const r = seed(...ONE_DOC)

    const res = await runGenerate({
      repoRoot: r,
      transport: failing(['guard.extract'], "Invalid schema for response_format: Missing 'extension'."),
    })

    expect(res.status).toBe('llm-failed')
    expect(res.reason).toContain('guard.extract')
    expect(res.reason).toContain("Missing 'extension'")
    expect(res.reason).toContain('the committed scenarios and manifest are unchanged')
    expect(res.written).toEqual([])
    // The affected document is NAMED, not just counted.
    expect(res.extractionFailures.map((f) => f.doc)).toEqual([DOC])
    expect(res.llmFailures).toEqual([
      {
        stage: 'guard.extract',
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

    const res = await runGenerate({ repoRoot: r, transport: failing(['guard.extract'], 'claude exited 1') })

    expect(res.status).toBe('llm-failed')
    expect(fs.readFileSync(manifestPath(r), 'utf-8')).toBe(prior.manifest)
    expect(fs.readFileSync(prior.file, 'utf-8')).toBe(prior.scenario)
  })
})

describe('flow synthesis losing every call aborts before flows.json is rewritten', () => {
  const flowsPath = (r: string): string => path.join(scenariosDir(r), 'flows.json')

  it('aborts on a thrown-call wipeout, leaving the committed flow corpus untouched', async () => {
    const r = seed(...ONE_DOC)
    // A committed corpus the abort must not clobber.
    fs.mkdirSync(scenariosDir(r), { recursive: true })
    fs.writeFileSync(flowsPath(r), '{"version":1,"generatedAt":"2026-01-01T00:00:00Z","flows":[],"noFlowClaims":[]}')
    const before = fs.readFileSync(flowsPath(r), 'utf-8')

    const res = await generateGuards({
      ...flowStageRunners(r),
      repoRoot: r,
      extractRunner: extractBy({}),
      turnFn: workerTurnsBy({}),
      flowsRunner: undefined,
      transport: failing(['guard.flows'], 'claude exited 1: expired login'),
    })

    expect(res.status).toBe('llm-failed')
    expect(res.reason).toContain('guard.flows')
    expect(res.llmFailures.find((f) => f.stage === 'guard.flows')?.failures).toBeGreaterThan(0)
    expect(fs.readFileSync(flowsPath(r), 'utf-8')).toBe(before)
    expect(fs.existsSync(manifestPath(r))).toBe(false)
  })

  it('aborts when every area ANSWERED unusably — no transport failure, the reason states the loss', async () => {
    const r = seed(...ONE_DOC)
    const garbage: FlowsRunner = async () => ({ nonsense: true })

    const res = await runGenerate({ repoRoot: r, extractRunner: extractBy({}), flowsRunner: garbage })

    expect(res.status).toBe('llm-failed')
    expect(res.reason).toContain('guard.flows')
    expect(res.reason).toContain('unusable')
    // The calls answered, so nothing is a TRANSPORT failure — the reason is the record.
    expect(res.llmFailures).toEqual([])
    // The corpus a wipeout would have written is never written at all.
    expect(fs.existsSync(flowsPath(r))).toBe(false)
  })
})

describe('matching losing every call aborts before a flow is re-authored', () => {
  it('keeps the prior scenarios the settle pass would have deleted', async () => {
    const r = seed(...ONE_DOC)
    const prior = commitPriorFlow(r)

    const res = await generateGuards({
      ...flowStageRunners(r),
      repoRoot: r,
      extractRunner: extractBy({}),
      turnFn: workerTurnsBy({}),
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

describe('authoring losing every session aborts before birth and before the settle pass', () => {
  it('aborts when every worker session died on its turns, keeping the prior scenarios', async () => {
    const r = seed(...ONE_DOC)
    const prior = commitPriorFlow(r)

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      turnFn: workerTurnBy({ version: { throws: 'claude exited 1: expired login' } }),
    })

    expect(res.status).toBe('llm-failed')
    expect(res.reason).toContain('guard.generate')
    expect(res.reason).toContain('claude exited 1: expired login')
    expect(res.written).toEqual([])
    // The turn seam is not audited, so the loss is in the errors, not a tally.
    expect(res.llmFailures).toEqual([])
    expect(res.errors.map((e) => e.message)).toEqual([
      'authoring (cli) worker session ended: turn-error — claude exited 1: expired login',
    ])
    // An LLM outage never deletes coverage.
    expect(fs.readFileSync(manifestPath(r), 'utf-8')).toBe(prior.manifest)
    expect(fs.readFileSync(prior.file, 'utf-8')).toBe(prior.scenario)
  })

  // The turns SUCCEED at the transport and come back with nothing the loop can act
  // on (a model that narrates instead of emitting its action block), so no call is
  // a transport failure — the run must still refuse to report success.
  it('aborts when every session ANSWERED unusably, with no transport failure recorded', async () => {
    const r = seed(...ONE_DOC)
    const prior = commitPriorFlow(r)

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      turnFn: workerTurnBy({ version: { malformed: true } }),
    })

    expect(res.status).toBe('llm-failed')
    expect(res.reason).toContain('guard.generate')
    expect(res.reason).toContain('unusable')
    expect(res.written).toEqual([])
    expect(res.llmFailures).toEqual([])
    expect(res.errors.map((e) => e.flowId)).toEqual(['version'])
    expect(res.errors[0].message).toContain('authoring (cli) worker session ended: malformed')
    expect(fs.readFileSync(manifestPath(r), 'utf-8')).toBe(prior.manifest)
    expect(fs.readFileSync(prior.file, 'utf-8')).toBe(prior.scenario)
  })

  it('one flow of two losing its session is NOT fatal — the other is written', async () => {
    const r = seed({ ref: DOC, content: DOC_CONTENT }, { ref: OTHER_DOC, content: OTHER_CONTENT })

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      turnFn: workerTurnBy({ help: { malformed: true } }),
      fidelityRunner: faithfulReviewer(),
    })

    expect(res.status).toBe('ok')
    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
    expect(res.errors.map((e) => e.flowId)).toEqual(['help'])
    // The failed flow keeps its per-flow fail-soft settle: no hash, so it is work
    // again next generate, while its healthy sibling settled.
    const flows = readManifest(r)!.flows
    expect(flows.find((f) => f.flowId === 'help')?.generationInputsHash).toBeNull()
    expect(flows.find((f) => f.flowId === 'version')?.generationInputsHash).not.toBeNull()
  })
})

describe('the adjudication stage ships unadjudicated on a systemic loss, never aborts', () => {
  // The carve-out (plan item 88). Adjudication judges what the worker session has
  // already authored and the sandbox has already executed: extract, flows, match,
  // the session and its runs have all been paid for by the time fidelity answers.
  // Aborting there throws away a whole run's spend over verdicts ABOUT content
  // birth already validated — annotation, not correctness. So the stage's collapse
  // ships the corpus and SAYS it was unadjudicated.
  it('fidelity losing every review persists the scenarios and reports the stage unadjudicated', async () => {
    const r = seed(...ONE_DOC)

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      turnFn: workerTurnBy({ version: raw('prints the version', PASSING_STEPS) }),
      // No injected reviewer — the stage spawns on the transport, as production does.
      fidelityRunner: undefined,
      transport: failing(['guard.fidelity'], 'claude exited 1'),
    })

    expect(res.status).toBe('ok')
    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
    expect(fs.existsSync(manifestPath(r))).toBe(true)
    // Loud, not silent: the run says which stage never adjudicated and how much
    // of the corpus shipped without it, and the lost calls are still tallied.
    expect(res.unadjudicated).toEqual([{ stage: 'guard.fidelity', affected: 1 }])
    expect(res.llmFailures.find((f) => f.stage === 'guard.fidelity')?.failures).toBeGreaterThan(0)
    // An unreviewed pass is NOT a rejection — nothing was withheld.
    expect(res.birthFindings).toEqual([])
  })

  // The stage spawns from the transport unconditionally: "this caller has no model
  // access" is never INFERRED from an absent transport (the OSS CLI installs none,
  // so inferring it there disabled fidelity in every OSS run — #858). A caller that
  // genuinely cannot reach a model attempts, loses every call, and ships its corpus
  // ANNOTATED — never a quiet skip that reads like a healthy run.
  it('a caller with NO transport does not skip fidelity — it runs, fails, and says so', async () => {
    const r = seed(...ONE_DOC)

    // No `transport`: the engine materializes its cli default, which the suite's
    // CLAUDE_CODE_BINARY tripwire points at a nonexistent binary.
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      turnFn: workerTurnBy({ version: raw('prints the version', PASSING_STEPS) }),
      fidelityRunner: undefined,
    })

    expect(res.status).toBe('ok')
    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
    expect(res.unadjudicated.map((u) => u.stage)).toEqual(['guard.fidelity'])
  })

  // The promise every surface makes ("re-run and it re-adjudicates them") is only
  // true if the flow does NOT settle on this run: a settled flow carries its inputs
  // hash, and the next generate skips it as unchanged — the corpus would stay
  // unreviewed forever, which is the very outcome the old abort existed to prevent.
  it('leaves the flow unsettled, so the next generate re-reviews it without re-authoring', async () => {
    const r = seed(...ONE_DOC)

    const first = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      turnFn: workerTurnBy({ version: raw('prints the version', PASSING_STEPS) }),
      fidelityRunner: undefined,
      transport: failing(['guard.fidelity'], 'claude exited 1'),
    })

    expect(first.unadjudicated).toEqual([{ stage: 'guard.fidelity', affected: 1 }])
    expect(first.written).toHaveLength(1)
    // No inputs hash ⇒ the flow is work again next generate.
    expect(readManifest(r)!.flows.find((f) => f.flowId === 'version')!.generationInputsHash).toBeNull()

    // The model is reachable again. Authoring is a CACHE hit (the flow, its
    // sections, its journeys and the recipe are all unchanged), so re-adjudicating
    // costs the review call and not one worker turn.
    const turns: LlmTurnRequest[] = []
    let reviewed = 0
    const second = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      turnFn: workerTurnBy({ version: raw('prints the version', PASSING_STEPS) }, (req) => turns.push(req)),
      fidelityRunner: faithfulReviewer(() => {
        reviewed++
      }),
    })

    expect(second.unadjudicated).toEqual([])
    expect(turns).toEqual([])
    expect(reviewed).toBe(1)
    expect(readManifest(r)!.flows.find((f) => f.flowId === 'version')!.generationInputsHash).not.toBeNull()
  })

  // The carve-out is EXACTLY one stage wide. A content stage — one whose loss
  // makes the corpus itself noise — still aborts before the first write.
  it('a content stage losing every call still aborts and writes nothing', async () => {
    const r = seed(...ONE_DOC)

    const res = await runGenerate({
      repoRoot: r,
      transport: failing(['guard.extract'], 'claude exited 1: expired login'),
    })

    expect(res.status).toBe('llm-failed')
    expect(res.reason).toContain('guard.extract')
    expect(res.written).toEqual([])
    expect(res.unadjudicated).toEqual([])
    expect(fs.existsSync(manifestPath(r))).toBe(false)
  })
})

describe('isolated failures stay fail-soft but are reported', () => {
  it('one document of two failed extraction: the other is generated and the failure is named', async () => {
    const r = seed({ ref: DOC, content: DOC_CONTENT }, { ref: OTHER_DOC, content: OTHER_CONTENT })

    // `docs/other.md` extraction fails; `docs/cli.md` answers.
    const half: LlmTransport = async (req) => {
      if (req.stage !== 'guard.extract') return '{}'
      if (req.id?.includes(OTHER_DOC)) throw new Error('claude API error (api 500)')
      return JSON.stringify({
        claims: [
          { claim: 'prints the version', driver: 'cli', sectionAnchor: 'version', reason: 'exit code is observable' },
        ],
        untestable: [],
      })
    }

    const res = await runGenerate({
      repoRoot: r,
      transport: half,
      turnFn: workerTurnBy({ version: raw('prints the version', PASSING_STEPS) }),
      fidelityRunner: faithfulReviewer(),
    })

    expect(res.status).toBe('ok')
    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
    expect(res.extractionFailures.map((f) => f.doc)).toEqual([OTHER_DOC])
    expect(res.llmFailures).toEqual([
      { stage: 'guard.extract', attempts: 2, failures: 1, firstError: 'claude API error (api 500)' },
    ])
  })

  it('a run whose stages never reach the transport reports no failures', async () => {
    const r = seed(...ONE_DOC)

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      turnFn: workerTurnBy({ version: raw('prints the version', PASSING_STEPS) }),
      fidelityRunner: faithfulReviewer(),
    })

    expect(res.status).toBe('ok')
    expect(res.llmFailures).toEqual([])
    expect(readManifest(r)?.flows.map((f) => f.flowId)).toEqual(['version'])
  })
})
