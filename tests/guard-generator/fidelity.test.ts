/**
 * THE FIDELITY JUDGE'S EFFECT ON THE CORPUS (plan 04 step 18), from the
 * engine's side: what a green candidate the judge FLAGS does to the run.
 *
 * The judge is no longer a pipeline stage — it is the depth-1 child
 * `submit_scenario` dispatches, so the seam hands the engine a
 * `WorkerFidelityJudge` and everything below drives that. The child's own
 * mechanics (its cache, its budget, its tool, the dispatch accounting) live in
 * `tests/core/guard-generate-worker-seam.test.ts`; the in-loop self-heal
 * sequencing lives in `tests/guard-generator/fidelity-self-heal.test.ts`.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { loadScenarios, readManifest } from '@truecourse/guard-runner'
import { GuardGenerateReportSchema } from '@truecourse/shared'
import {
  PASSING_STEPS,
  extractSessionBy,
  judgeBy,
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

/** version → default cli claim, background → untestable. */
const versionExtract = extractSessionBy({ background: { untestable: 'design history' } })

function seed(): string {
  const r = repo()
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, DOC_CONTENT)
  return r
}

/** The manifest entry for one flow (v2 is flow-keyed). */
function flowEntry(repoRoot: string, flowId: string) {
  return readManifest(repoRoot)?.flows.find((f) => f.flowId === flowId)
}

describe('generateGuards — the fidelity child’s verdict', () => {
  it('a FAITHFUL green scenario persists exactly as before', async () => {
    const r = seed()
    const res = await runGenerate({
      repoRoot: r,
      extractSession: versionExtract,
      flowWorkerSession: submitWorkerSessions(() => raw('v', PASSING_STEPS)),
    })
    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
    expect(res.birthFindings).toEqual([])
    expect(loadScenarios(r).scenarios.map((s) => s.id)).toEqual(['version'])
  }, 60_000)

  it('a FLAGGED green scenario becomes a fidelity finding — nothing persisted, the flow re-runs', async () => {
    const r = seed()
    const res = await runGenerate({
      repoRoot: r,
      extractSession: versionExtract,
      flowWorkerSession: submitWorkerSessions(() => raw('weak', PASSING_STEPS), {
        judge: judgeBy({ weak: 'asserts exit 0 but the claim quotes exact output' }),
        onRefusal: 'retire',
      }),
    })

    // The confirmation run passed (the review is post-run) but nothing persisted.
    expect(res.written).toEqual([])
    expect(loadScenarios(r).scenarios).toEqual([])

    // Recorded as a fidelity finding: kind + the judge's mismatch as evidence,
    // with the yaml + claim inline exactly like a birth finding, plus the flow it
    // belongs to and the surface it was authored for.
    expect(res.birthFindings).toHaveLength(1)
    const f = res.birthFindings[0]
    expect(f.kind).toBe('fidelity')
    expect(f.anchor).toBe('version')
    expect(f.flowId).toBe('version')
    expect(f.surface).toBe('cli')
    expect(f.title).toBe('weak')
    expect(f.actual).toBe('asserts exit 0 but the claim quotes exact output')
    expect(f.yaml).toContain('title: weak')
    expect(f.claim).toBeTruthy()
    // No birth-evidence transcript — a fidelity finding never ran a failing step.
    expect(f.evidencePath).toBeUndefined()

    // The flow keeps its manifest entry (its bindings are real coverage) but records
    // NO inputs hash, so the next generate re-runs it.
    const entry = flowEntry(r, 'version')
    expect(entry?.scenarios).toEqual([])
    expect(entry?.generationInputsHash).toBeNull()
    expect(res.flows.unsettled).toBe(1)
  }, 60_000)

  it('a flagged flow never withholds a SIBLING flow — findings are independent', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, ['## version', 'v claim.', '', '## help', 'h claim.'].join('\n'))

    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: submitWorkerSessions(
        (task) => (task.flowId === 'version' ? raw('good', PASSING_STEPS) : raw('bad', PASSING_STEPS)),
        {
          judge: judgeBy({ bad: 'miscast: tests a different command than the claim' }),
          onRefusal: 'retire',
        },
      ),
    })

    // The healthy flow persisted; the flagged one is a finding. Nothing is held.
    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
    expect(res.birthFindings.map((f) => f.title)).toEqual(['bad'])
    expect(loadScenarios(r).scenarios.map((s) => s.id)).toEqual(['version'])
    expect(res.flows.settled).toBe(1)
    expect(res.flows.unsettled).toBe(1)
  }, 90_000)

  it('a fidelity finding round-trips through the report schema (kind: fidelity)', () => {
    const rep = {
      generatedAt: '2026-07-10T00:00:00.000Z',
      status: 'ok' as const,
      sectionsTotal: 1,
      sectionsChanged: 1,
      skippedUnchanged: 0,
      noChanges: false,
      written: [],
      coverageGaps: [],
      birthFindings: [
        {
          doc: DOC,
          anchor: 'version',
          kind: 'fidelity' as const,
          title: 'weak',
          step: 1,
          expected: "a scenario that verifies the flow's milestones",
          actual: 'asserts exit 0 but the claim quotes exact output',
          yaml: 'title: weak\n',
          claim: 'the version claim',
          flowId: 'version',
          surface: 'cli' as const,
        },
      ],
      errors: [],
      extractionFailures: [],
      orphaned: [],
    }
    expect(() => GuardGenerateReportSchema.parse(rep)).not.toThrow()
  })
})
