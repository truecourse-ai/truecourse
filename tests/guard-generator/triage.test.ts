import { describe, it, expect, afterEach } from 'vitest'
import {
  runTriage,
  triageCacheKey,
  buildTriageUserPrompt,
  TRIAGE_SYSTEM_PROMPT,
  type TriageRunner,
  type TriageUserContext,
} from '@truecourse/guard-generator'
import type { GuardBirthFinding, GuardTriage } from '@truecourse/shared'
import { loadScenarios, readManifest } from '@truecourse/guard-runner'
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

const CODE_DRIFT: GuardTriage = {
  verdict: 'code-drift',
  confidence: 'high',
  brief: 'The doc promises exit 0; the program exits 7.',
  recommendation: 'Fix the command to exit 0, or update the doc.',
}

function finding(overrides: Partial<GuardBirthFinding> = {}): GuardBirthFinding {
  return {
    doc: DOC,
    anchor: 'version',
    title: 'always broken',
    claim: 'relkit --version exits 0',
    step: 1,
    expected: 'exit 0',
    actual: 'exit 7',
    flowId: 'version',
    surface: 'cli',
    yaml: 'title: always broken',
    ...overrides,
  }
}

const FLOW_CTX = {
  flow: { id: 'version', title: 'version', goal: 'verify the version claim' },
  surface: 'cli' as const,
  sectionHeading: 'version',
  sectionText: '`relkit --version` prints the version and exits 0.',
  milestones: [{ order: 1, claim: 'relkit --version exits 0', failed: true }],
}

describe('triage — prompt + identity', () => {
  it('the system prompt offers exactly the three verdicts and carries the canonical schema', () => {
    expect(TRIAGE_SYSTEM_PROMPT).toContain('doc-drift')
    expect(TRIAGE_SYSTEM_PROMPT).toContain('code-drift')
    expect(TRIAGE_SYSTEM_PROMPT).toContain('generation-defect')
    // Environment is a STATE the runner routes deterministically — never a verdict.
    expect(TRIAGE_SYSTEM_PROMPT).toContain('NO "environment" verdict')
    // The schema hint is rendered from the same Zod definition the engine parses with.
    expect(TRIAGE_SYSTEM_PROMPT).toContain('"verdict"')
    expect(TRIAGE_SYSTEM_PROMPT).toContain('"recommendation"')
  })

  it('the user prompt shows the interface: milestones, the failing one marked, and the transcript', () => {
    const ctx: TriageUserContext = {
      ...FLOW_CTX,
      doc: DOC,
      milestones: [
        { order: 1, claim: 'first claim' },
        { order: 2, claim: 'second claim', failed: true },
      ],
      scenarioYaml: 'title: t\nsteps: []',
      step: 2,
      failedMilestone: 2,
      expected: 'exit 0',
      actual: 'exit 7',
      stderr: 'fatal: intentional failure',
    }
    const prompt = buildTriageUserPrompt(ctx)
    expect(prompt).toContain('1. first claim')
    expect(prompt).toContain('2. second claim   ← the failing step realized THIS milestone')
    expect(prompt).toContain('Failing step: 2 (milestone 2)')
    expect(prompt).toContain('fatal: intentional failure')
    expect(prompt).toContain('title: t')
  })

  it('renders the api request-surface grounding when the plan carries contracts', () => {
    const prompt = buildTriageUserPrompt({
      ...FLOW_CTX,
      surface: 'api',
      doc: DOC,
      scenarioYaml: '',
      step: 1,
      expected: '201',
      actual: '400',
      interfaceContracts: [
        { method: 'POST', path: '/todos', bodyFields: [{ name: 'title', required: true }] },
      ],
    })
    expect(prompt).toContain('REQUEST SURFACE')
    expect(prompt).toContain('POST /todos — body requires title')
  })

  it('the cache key is the failure identity — it moves with the evidence, not the yaml', () => {
    const base = triageCacheKey(finding())
    expect(triageCacheKey(finding())).toBe(base)
    expect(triageCacheKey(finding({ yaml: 'different yaml' }))).toBe(base)
    expect(triageCacheKey(finding({ actual: 'exit 3' }))).not.toBe(base)
    expect(triageCacheKey(finding({ claim: 'another claim' }))).not.toBe(base)
    expect(triageCacheKey(finding({ surface: 'api' }))).not.toBe(base)
  })
})

describe('triage — the call', () => {
  it('caches a validated verdict per failure identity — the second triage is a hit', async () => {
    const r = repo()
    let calls = 0
    const runner: TriageRunner = async () => {
      calls++
      return CODE_DRIFT
    }
    expect(await runTriage(r, finding(), FLOW_CTX, runner)).toEqual(CODE_DRIFT)
    expect(await runTriage(r, finding(), FLOW_CTX, runner)).toEqual(CODE_DRIFT)
    expect(calls).toBe(1)
  })

  it('re-asks ONCE with the invalid output quoted back, then fails soft', async () => {
    const r = repo()
    const seen: TriageUserContext[] = []
    const invalidTwice: TriageRunner = async (ctx) => {
      seen.push(ctx)
      return { verdict: 'flaky-environment' }
    }
    expect(await runTriage(r, finding(), FLOW_CTX, invalidTwice)).toBeNull()
    expect(seen).toHaveLength(2)
    expect(seen[1].correction?.invalidOutput).toContain('flaky-environment')

    // A thrown call is not re-asked and nothing is cached.
    let threw = 0
    const throwing: TriageRunner = async () => {
      threw++
      throw new Error('transport died')
    }
    expect(await runTriage(r, finding({ actual: 'other' }), FLOW_CTX, throwing)).toBeNull()
    expect(threw).toBe(1)
  })

  it('a failure is not cached — the next call really re-asks the model', async () => {
    const r = repo()
    let calls = 0
    const flaky: TriageRunner = async () => {
      calls++
      if (calls === 1) throw new Error('first call dies')
      return CODE_DRIFT
    }
    expect(await runTriage(r, finding(), FLOW_CTX, flaky)).toBeNull()
    expect(await runTriage(r, finding(), FLOW_CTX, flaky)).toEqual(CODE_DRIFT)
  })
})

describe('triage — in the generate pipeline', () => {
  it('a failing test carries the verdict; the flow context reaches the runner', async () => {
    const r = seed()
    const seen: TriageUserContext[] = []
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('always broken', FAILING_STEPS) }),
      triageRunner: async (ctx) => {
        seen.push(ctx)
        return CODE_DRIFT
      },
    })

    expect(res.birthFindings).toHaveLength(1)
    expect(res.birthFindings[0].triage).toEqual(CODE_DRIFT)
    // Verdict on the TEST, not the flow — the identity travels with the finding.
    expect(res.birthFindings[0].scenarioId).toBe('version.cli.1')

    expect(seen).toHaveLength(1)
    expect(seen[0].flow.id).toBe('version')
    expect(seen[0].surface).toBe('cli')
    expect(seen[0].sectionText).toContain('relkit --version')
    expect(seen[0].milestones).toHaveLength(1)
    expect(seen[0].scenarioYaml).toContain('always broken')
    expect(seen[0].actual).toContain('exit')
  })

  it('no failing test ⇒ no triage call; a call that cannot complete commits untriaged', async () => {
    const green = seed()
    let calls = 0
    await runGenerate({
      repoRoot: green,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('ok', PASSING_STEPS) }),
      triageRunner: async () => {
        calls++
        return CODE_DRIFT
      },
    })
    expect(calls).toBe(0)

    // The fail-soft half: the stage runs (production always spawns it), its ONE
    // call dies, and the failing test commits with no verdict rather than being
    // withheld. Nothing in the pipeline may make the stage itself conditional.
    const red = seed()
    const res = await runGenerate({
      repoRoot: red,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('always broken', FAILING_STEPS) }),
      triageRunner: async () => {
        throw new Error('transport died')
      },
    })
    expect(res.written).toMatchObject([{ id: 'version.cli.1', status: 'failing' }])
    expect(res.birthFindings[0].triage).toBeUndefined()
  })

  it('routes by verdict: repo-blamed commits WITH its diagnosis; the identity reconciles', async () => {
    const r = seed()
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('always broken', FAILING_STEPS) }),
      triageRunner: async () => CODE_DRIFT,
    })

    // Committed red drift: the test is written, the manifest scenario carries the
    // diagnosis (with the verdict), and the flow SETTLES.
    expect(res.written).toMatchObject([{ id: 'version.cli.1', status: 'failing' }])
    const manifest = readManifest(r)!.flows.find((f) => f.flowId === 'version')!
    expect(manifest.scenarios[0].diagnosis).toMatchObject({
      title: 'always broken',
      triage: { verdict: 'code-drift' },
      file: res.written[0].file,
    })
    expect(manifest.generationInputsHash).not.toBeNull()

    // B6 arithmetic: every failing written test has exactly one committed row.
    const committedRows = res.birthFindings.filter((f) => f.kind !== 'fidelity' && f.committed)
    expect(committedRows).toHaveLength(res.written.filter((w) => w.status === 'failing').length)
  })

  it('a generation-defect verdict WITHHOLDS the test — nothing committed, the flow re-runs', async () => {
    const r = seed()
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('always broken', FAILING_STEPS) }),
      triageRunner: async () => ({
        verdict: 'generation-defect',
        confidence: 'medium',
        brief: 'The scenario asserts a value the section never states.',
        recommendation: 'Author against the documented exit code instead.',
      }),
    })

    // Never committed: no test on disk, no manifest scenario, no written entry.
    expect(res.written).toEqual([])
    expect(loadScenarios(r).scenarios).toEqual([])
    const entry = readManifest(r)!.flows.find((f) => f.flowId === 'version')!
    expect(entry.scenarios).toEqual([])
    // The withheld finding is visible — with its verdict — and the flow stays
    // UNSETTLED so the next generate re-authors it.
    expect(res.birthFindings).toHaveLength(1)
    expect(res.birthFindings[0].committed).toBeUndefined()
    expect(res.birthFindings[0].triage?.verdict).toBe('generation-defect')
    expect(entry.generationInputsHash).toBeNull()
    expect(res.flows).toMatchObject({ settled: 0, unsettled: 1 })
  })

  it('a fail-soft triage (invalid output twice) still commits the failing test', async () => {
    const r = seed()
    const onTriage: Array<[number, number]> = []
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: versionCliBgUntestable,
      generateRunner: authorBy({ version: raw('always broken', FAILING_STEPS) }),
      triageRunner: async () => ({ nonsense: true }),
      onTriageProgress: (done, total) => onTriage.push([done, total]),
    })
    expect(res.written).toMatchObject([{ id: 'version.cli.1', status: 'failing' }])
    expect(res.birthFindings[0].triage).toBeUndefined()
    // Progress announced the denominator up front, then settled it.
    expect(onTriage[0]).toEqual([0, 1])
    expect(onTriage[onTriage.length - 1]).toEqual([1, 1])
  })
})
