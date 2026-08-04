import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  authorCacheKey,
  RawGeneratedApiScenarioSchema,
  SeedExecutionNotAuthorizedError,
  type RawGeneratedScenario,
} from '@truecourse/guard-generator'
import type { GuardExecInput, GuardExecReport } from '@truecourse/guard-runner'
import { GUARD_FORMAT_VERSION, type GuardLatest, type GuardScenarioResult } from '@truecourse/shared'
import {
  apiJourney,
  authorBy,
  extractBy,
  journeysOf,
  makeTempRepo,
  PASSING_API_STEPS,
  rawApi,
  rmrf,
  runGenerate,
  stampMilestones,
  writeApiRecipe,
  writeCorpus,
  writeDoc,
} from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

function repo(): string {
  const value = makeTempRepo()
  repos.push(value)
  return value
}

const DOC = 'docs/api.md'
const SIDE_EFFECT_FREE_SEED = [
  "import fs from 'node:fs'",
  "const namespace = process.env.GUARD_SEED_NAMESPACE",
  "fs.writeFileSync(process.env.GUARD_SEED_OUT, JSON.stringify({ fixtures: { account: { id: `${namespace}-a-1` } } }))",
  '',
].join('\n')

function seededScenario(source = SIDE_EFFECT_FREE_SEED): RawGeneratedScenario {
  return rawApi('reads the arranged account', PASSING_API_STEPS, {
    setup: { seed: { provides: { fixtures: { account: ['id'] } } } },
    preconditions: [
      {
        description: 'an account exists before the server boots',
        mechanism: 'sidecar',
        outputs: ['fixture:account'],
      },
    ],
    seedSidecar: { source, access: 'repository-modules' },
  } as Partial<RawGeneratedScenario>)
}

function prepare(r: string): void {
  writeApiRecipe(r, { entry: null })
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, '## list\nGET /todos returns 200 with the todo list.\n')
}

function passingExecutor(inputs: GuardExecInput[]): (input: GuardExecInput) => Promise<GuardExecReport> {
  return async (input) => {
    inputs.push(input)
    const scenarios: GuardScenarioResult[] = input.scenarios.map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      binds: scenario.binds,
      ...(scenario.flow ? { flowId: scenario.flow.id } : {}),
      outcome: 'pass',
      durationMs: 1,
    }))
    const latest: GuardLatest = {
      run: {
        runId: 'birth',
        ranAt: '2026-08-04T00:00:00.000Z',
        branch: null,
        commit: null,
        recipeFingerprint: 'sha256:recipe',
        scenarioFormat: GUARD_FORMAT_VERSION,
      },
      summary: { total: scenarios.length, pass: scenarios.length, fail: 0, stale: 0, orphaned: 0, error: 0 },
      scenarios,
      sections: [],
    }
    return { status: 'ok', latest, latestPath: '', loadErrors: [], manifest: null }
  }
}

function outcomeExecutor(
  inputs: GuardExecInput[],
  decide: (input: GuardExecInput) => GuardScenarioResult['outcome'],
): (input: GuardExecInput) => Promise<GuardExecReport> {
  return async (input) => {
    inputs.push(input)
    const scenarios: GuardScenarioResult[] = input.scenarios.map((scenario) => {
      const outcome = decide(input)
      return {
        id: scenario.id,
        title: scenario.title,
        binds: scenario.binds,
        ...(scenario.flow ? { flowId: scenario.flow.id } : {}),
        outcome,
        durationMs: 1,
        ...(outcome === 'pass'
          ? {}
          : {
              failure: {
                step: 1,
                expected: outcome === 'error' ? 'scenario seed to materialize' : 'status 200',
                actual: outcome === 'error' ? 'sidecar exited 7: redacted diagnostic' : 'status 500',
              },
            }),
      }
    })
    const count = (outcome: GuardScenarioResult['outcome']): number => scenarios.filter((s) => s.outcome === outcome).length
    const latest: GuardLatest = {
      run: {
        runId: 'birth',
        ranAt: '2026-08-04T00:00:00.000Z',
        branch: null,
        commit: null,
        recipeFingerprint: 'sha256:recipe',
        scenarioFormat: GUARD_FORMAT_VERSION,
      },
      summary: {
        total: scenarios.length,
        pass: count('pass'),
        fail: count('fail'),
        stale: 0,
        orphaned: 0,
        error: count('error'),
      },
      scenarios,
      sections: [],
    }
    return { status: 'ok', latest, latestPath: '', loadErrors: [], manifest: null }
  }
}

describe('generated per-scenario seed sidecars', () => {
  it('moves generation cache identity when static YAML/sidecar material changes', () => {
    const common = [{ fingerprint: 'sha256:flow' }, 'api' as const, ['sha256:section'], ['sha256:journey'], 'sha256:recipe'] as const
    const first = authorCacheKey(...common, 'sha256:yaml-sidecar-a')
    const second = authorCacheKey(...common, 'sha256:yaml-sidecar-b')

    expect(first).not.toBe(second)
  })

  it('requires a documented sidecar precondition for every declared seed output', () => {
    const candidate = seededScenario() as Record<string, unknown>
    candidate.preconditions = []

    const parsed = RawGeneratedApiScenarioSchema.safeParse(candidate)

    expect(parsed.success).toBe(false)
    expect(parsed.error?.message).toContain('fixture:account')
  })

  it('rejects sidecar source that cannot participate in deterministic namespaced materialization', () => {
    const parsed = RawGeneratedApiScenarioSchema.safeParse(seededScenario('export default async function seed() {}'))

    expect(parsed.success).toBe(false)
    expect(parsed.error?.message).toContain('GUARD_SEED_NAMESPACE')
    expect(parsed.error?.message).toContain('GUARD_SEED_OUT')
  })

  it('includes the sidecar source and precondition plan in fidelity review', async () => {
    const r = repo()
    prepare(r)
    const reviewed: Array<{ seedSidecarSource?: string; seedPreconditions?: unknown[] }> = []

    const result = await runGenerate({
      repoRoot: r,
      journeys: journeysOf(r, apiJourney('GET', '/todos')),
      extractRunner: extractBy({ list: [{ driver: 'api', claim: 'GET /todos returns 200', reason: 'status' }] }),
      generateRunner: authorBy({ list: seededScenario() }),
      executor: passingExecutor([]),
      fidelityRunner: async (ctx) => {
        reviewed.push(ctx)
        return { verdict: 'faithful' }
      },
      allowSeedExec: true,
    })

    expect(result.status).toBe('ok')
    expect(reviewed).toEqual([
      expect.objectContaining({
        seedSidecarSource: SIDE_EFFECT_FREE_SEED,
        seedPreconditions: [expect.objectContaining({ mechanism: 'sidecar', outputs: ['fixture:account'] })],
      }),
    ])
  })

  it('rejects a generated fixture that has both run-level and scenario-local sources before birth', async () => {
    const r = repo()
    prepare(r)
    const recipePath = path.join(r, '.truecourse', 'scenarios', 'recipe.json')
    const recipe = JSON.parse(fs.readFileSync(recipePath, 'utf8'))
    recipe.api.seed = {
      command: 'node seed.mjs',
      provides: { fixtures: { account: ['id'] } },
    }
    fs.writeFileSync(recipePath, JSON.stringify(recipe))
    const executorInputs: GuardExecInput[] = []

    const result = await runGenerate({
      repoRoot: r,
      journeys: journeysOf(r, apiJourney('GET', '/todos')),
      extractRunner: extractBy({ list: [{ driver: 'api', claim: 'GET /todos returns 200', reason: 'status' }] }),
      generateRunner: authorBy({ list: seededScenario() }),
      executor: passingExecutor(executorInputs),
      allowSeedExec: true,
    })

    expect(result.status).toBe('llm-failed')
    expect(result.reason).toContain('fixture "account" has more than one declared source')
    expect(executorInputs).toEqual([])
  })

  it('rejects a fixture reference without exactly one declared provider before birth', async () => {
    const r = repo()
    prepare(r)
    const executorInputs: GuardExecInput[] = []
    const candidate = seededScenario() as Record<string, unknown>
    candidate.steps = [
      {
        request: { method: 'GET', path: '/todos/{{fixture:missing.id}}' },
        expect: { status: 200 },
      },
    ]

    const result = await runGenerate({
      repoRoot: r,
      journeys: journeysOf(r, apiJourney('GET', '/todos')),
      extractRunner: extractBy({ list: [{ driver: 'api', claim: 'GET /todos returns 200', reason: 'status' }] }),
      generateRunner: authorBy({ list: candidate as RawGeneratedScenario }),
      executor: passingExecutor(executorInputs),
      allowSeedExec: true,
    })

    expect(result.status).toBe('llm-failed')
    expect(result.reason).toContain('fixture "missing" has no declared source')
    expect(executorInputs).toEqual([])
  })

  it('refuses before execution or persistence when sidecar authority is absent', async () => {
    const r = repo()
    prepare(r)
    const executorInputs: GuardExecInput[] = []

    await expect(
      runGenerate({
        repoRoot: r,
        journeys: journeysOf(r, apiJourney('GET', '/todos')),
        extractRunner: extractBy({ list: [{ driver: 'api', claim: 'GET /todos returns 200', reason: 'status' }] }),
        generateRunner: authorBy({ list: seededScenario() }),
        executor: passingExecutor(executorInputs),
      }),
    ).rejects.toBeInstanceOf(SeedExecutionNotAuthorizedError)

    expect(executorInputs).toEqual([])
    expect(fs.existsSync(path.join(r, '.truecourse', 'scenarios', 'api', 'list.api.1.yaml'))).toBe(false)
    expect(fs.existsSync(path.join(r, '.truecourse', 'scenarios', 'api', 'list.api.1.seed.mjs'))).toBe(false)
  })

  it('rechecks authority when an evidence retry introduces the first sidecar', async () => {
    const r = repo()
    prepare(r)
    const executorInputs: GuardExecInput[] = []

    await expect(
      runGenerate({
        repoRoot: r,
        journeys: journeysOf(r, apiJourney('GET', '/todos')),
        extractRunner: extractBy({ list: [{ driver: 'api', claim: 'GET /todos returns 200', reason: 'status' }] }),
        generateRunner: async (ctx) => ({
          scenario: stampMilestones(ctx.retry ? seededScenario() : rawApi('reads todos', PASSING_API_STEPS), ctx.milestones.length),
        }),
        executor: outcomeExecutor(executorInputs, (input) => (input.artifacts?.[0].companions && Object.keys(input.artifacts[0].companions).length > 0 ? 'pass' : 'fail')),
      }),
    ).rejects.toBeInstanceOf(SeedExecutionNotAuthorizedError)

    expect(executorInputs).toHaveLength(1)
    expect(fs.existsSync(path.join(r, '.truecourse', 'scenarios', 'api', 'list.api.1.seed.mjs'))).toBe(false)
  })

  it('asks again before an evidence retry executes changed sidecar source', async () => {
    const r = repo()
    prepare(r)
    const executorInputs: GuardExecInput[] = []
    const approvals: Array<Array<{ sourceFingerprint: string }>> = []
    const repairedSeed = `${SIDE_EFFECT_FREE_SEED}// repaired arrangement\n`

    const result = await runGenerate({
      repoRoot: r,
      journeys: journeysOf(r, apiJourney('GET', '/todos')),
      extractRunner: extractBy({ list: [{ driver: 'api', claim: 'GET /todos returns 200', reason: 'status' }] }),
      generateRunner: async (ctx) => ({
        scenario: stampMilestones(seededScenario(ctx.retry ? repairedSeed : SIDE_EFFECT_FREE_SEED), ctx.milestones.length),
      }),
      executor: outcomeExecutor(executorInputs, () => (executorInputs.length === 1 ? 'error' : 'pass')),
      approveSeedExecution: async (summary) => {
        approvals.push(summary)
        return true
      },
    })

    expect(result.status).toBe('ok')
    expect(approvals).toHaveLength(2)
    expect(approvals[0][0].sourceFingerprint).not.toBe(approvals[1][0].sourceFingerprint)
    expect(executorInputs).toHaveLength(2)
  })

  it('summarizes once, birth-validates exact transient sources, and persists the approved pair', async () => {
    const r = repo()
    prepare(r)
    const executorInputs: GuardExecInput[] = []
    const approvals: unknown[] = []

    const result = await runGenerate({
      repoRoot: r,
      journeys: journeysOf(r, apiJourney('GET', '/todos')),
      extractRunner: extractBy({ list: [{ driver: 'api', claim: 'GET /todos returns 200', reason: 'status' }] }),
      generateRunner: authorBy({ list: seededScenario() }),
      executor: passingExecutor(executorInputs),
      approveSeedExecution: async (summary) => {
        approvals.push(summary)
        return true
      },
    })

    expect(approvals).toEqual([
      [
        expect.objectContaining({
          scenarioId: 'list.api.1',
          outputs: ['fixture:account'],
          access: 'repository-modules',
        }),
      ],
    ])
    expect(executorInputs).toHaveLength(1)
    expect(executorInputs[0].artifacts).toEqual([
      expect.objectContaining({
        source: expect.objectContaining({ path: '.truecourse/scenarios/api/list.api.1.yaml' }),
        companions: { '.truecourse/scenarios/api/list.api.1.seed.mjs': SIDE_EFFECT_FREE_SEED },
      }),
    ])

    const yamlPath = path.join(r, result.written[0].file)
    const sidecarPath = yamlPath.replace(/\.yaml$/, '.seed.mjs')
    expect(fs.readFileSync(sidecarPath, 'utf8')).toBe(SIDE_EFFECT_FREE_SEED)
    expect(fs.readFileSync(yamlPath, 'utf8')).toBe(executorInputs[0].artifacts![0].source.content)
  })

  it('never replaces a handwritten pair when allocating a generated id', async () => {
    const r = repo()
    prepare(r)
    const manualDir = path.join(r, '.truecourse', 'scenarios', 'api')
    fs.mkdirSync(manualDir, { recursive: true })
    const manualYaml = JSON.stringify({
      guard: GUARD_FORMAT_VERSION,
      id: 'list.api.1',
      title: 'handwritten baseline',
      binds: [{ doc: DOC, section: 'list', fingerprint: 'sha256:manual' }],
      driver: 'api',
      setup: { seed: { provides: { fixtures: { manual: ['id'] } } } },
      steps: [{ request: { method: 'GET', path: '/todos' }, expect: { status: 200 } }],
      normalize: [],
    })
    const manualSidecar = '// handwritten and owned by the user\n'
    fs.writeFileSync(path.join(manualDir, 'list.api.1.yaml'), manualYaml)
    fs.writeFileSync(path.join(manualDir, 'list.api.1.seed.mjs'), manualSidecar)

    const result = await runGenerate({
      repoRoot: r,
      journeys: journeysOf(r, apiJourney('GET', '/todos')),
      extractRunner: extractBy({ list: [{ driver: 'api', claim: 'GET /todos returns 200', reason: 'status' }] }),
      generateRunner: authorBy({ list: seededScenario() }),
      executor: passingExecutor([]),
      allowSeedExec: true,
    })

    expect(result.written).toMatchObject([{ id: 'list.api.2' }])
    expect(fs.readFileSync(path.join(manualDir, 'list.api.1.yaml'), 'utf8')).toBe(manualYaml)
    expect(fs.readFileSync(path.join(manualDir, 'list.api.1.seed.mjs'), 'utf8')).toBe(manualSidecar)
  })

  it('replaces a generated pair with seedless YAML and removes the owned stale sidecar', async () => {
    const r = repo()
    prepare(r)
    const base = {
      repoRoot: r,
      journeys: journeysOf(r, apiJourney('GET', '/todos')),
      extractRunner: extractBy({ list: [{ driver: 'api' as const, claim: 'GET /todos returns 200', reason: 'status' }] }),
      executor: passingExecutor([]),
    }
    const first = await runGenerate({
      ...base,
      generateRunner: authorBy({ list: seededScenario() }),
      allowSeedExec: true,
    })
    const yamlPath = path.join(r, first.written[0].file)
    const sidecarPath = yamlPath.replace(/\.yaml$/, '.seed.mjs')
    expect(fs.existsSync(sidecarPath)).toBe(true)

    writeDoc(r, DOC, '## list\nGET /todos returns 200 with the complete todo list.\n')
    const second = await runGenerate({
      ...base,
      journeys: journeysOf(r, apiJourney('GET', '/todos')),
      generateRunner: authorBy({ list: rawApi('reads the todo list', PASSING_API_STEPS) }),
    })

    expect(second.written).toMatchObject([{ id: 'list.api.1' }])
    expect(fs.existsSync(yamlPath)).toBe(true)
    expect(fs.existsSync(sidecarPath)).toBe(false)
  })

  it('re-authors both transient members once after an arrangement error and persists only the repaired pair', async () => {
    const r = repo()
    prepare(r)
    const executorInputs: GuardExecInput[] = []
    const bad = `${SIDE_EFFECT_FREE_SEED}// BAD arrangement\n`
    const repaired = SIDE_EFFECT_FREE_SEED

    const result = await runGenerate({
      repoRoot: r,
      journeys: journeysOf(r, apiJourney('GET', '/todos')),
      extractRunner: extractBy({ list: [{ driver: 'api', claim: 'GET /todos returns 200', reason: 'status' }] }),
      generateRunner: authorBy({ list: { first: seededScenario(bad), retry: seededScenario(repaired) } }),
      executor: outcomeExecutor(executorInputs, (input) =>
        Object.values(input.artifacts![0].companions)[0].includes('BAD') ? 'error' : 'pass',
      ),
      allowSeedExec: true,
    })

    expect(executorInputs).toHaveLength(2)
    expect(Object.values(executorInputs[0].artifacts![0].companions)[0]).toBe(bad)
    expect(Object.values(executorInputs[1].artifacts![0].companions)[0]).toBe(repaired)
    expect(result.written).toMatchObject([{ id: 'list.api.1', status: 'passing' }])
    expect(fs.readFileSync(path.join(r, result.written[0].file.replace(/\.yaml$/, '.seed.mjs')), 'utf8')).toBe(repaired)
  })

  it('turns a demonstrated retry limitation into a missing-data gap and withholds both files', async () => {
    const r = repo()
    prepare(r)
    const executorInputs: GuardExecInput[] = []

    const result = await runGenerate({
      repoRoot: r,
      journeys: journeysOf(r, apiJourney('GET', '/todos')),
      extractRunner: extractBy({ list: [{ driver: 'api', claim: 'GET /todos returns 200', reason: 'status' }] }),
      generateRunner: async (ctx) =>
        ctx.retry
          ? { blockedOn: ['missing-data', 'no safe repository ownership boundary for an account'] }
          : { scenario: stampMilestones(seededScenario(), ctx.milestones.length) },
      executor: outcomeExecutor(executorInputs, () => 'error'),
      allowSeedExec: true,
    })

    expect(executorInputs).toHaveLength(1)
    expect(result.coverageGaps).toEqual([
      expect.objectContaining({ kind: 'blocked-on', reason: expect.stringContaining('missing-data') }),
    ])
    expect(result.written).toEqual([])
    expect(fs.existsSync(path.join(r, '.truecourse', 'scenarios', 'api', 'list.api.1.yaml'))).toBe(false)
    expect(fs.existsSync(path.join(r, '.truecourse', 'scenarios', 'api', 'list.api.1.seed.mjs'))).toBe(false)
  })

  it('withholds both files and leaves an authoring error after the single repair also fails arrangement', async () => {
    const r = repo()
    prepare(r)
    const executorInputs: GuardExecInput[] = []

    const result = await runGenerate({
      repoRoot: r,
      journeys: journeysOf(r, apiJourney('GET', '/todos')),
      extractRunner: extractBy({ list: [{ driver: 'api', claim: 'GET /todos returns 200', reason: 'status' }] }),
      generateRunner: authorBy({ list: seededScenario() }),
      executor: outcomeExecutor(executorInputs, () => 'error'),
      allowSeedExec: true,
    })

    expect(executorInputs).toHaveLength(2)
    expect(result.written).toEqual([])
    expect(result.birthFindings).toEqual([])
    expect(result.errors).toEqual([
      expect.objectContaining({ kind: 'birth', message: expect.stringContaining('sidecar exited 7') }),
    ])
    expect(result.flows.unsettled).toBe(1)
    expect(fs.existsSync(path.join(r, '.truecourse', 'scenarios', 'api', 'list.api.1.yaml'))).toBe(false)
    expect(fs.existsSync(path.join(r, '.truecourse', 'scenarios', 'api', 'list.api.1.seed.mjs'))).toBe(false)
  })

  it('keeps an assertion failure after successful arrangement as an ordinary product finding', async () => {
    const r = repo()
    prepare(r)
    const executorInputs: GuardExecInput[] = []

    const result = await runGenerate({
      repoRoot: r,
      journeys: journeysOf(r, apiJourney('GET', '/todos')),
      extractRunner: extractBy({ list: [{ driver: 'api', claim: 'GET /todos returns 200', reason: 'status' }] }),
      generateRunner: authorBy({ list: seededScenario() }),
      executor: outcomeExecutor(executorInputs, () => 'fail'),
      allowSeedExec: true,
    })

    expect(result.written).toMatchObject([{ id: 'list.api.1', status: 'failing' }])
    expect(result.birthFindings).toEqual([
      expect.objectContaining({ expected: 'status 200', actual: 'status 500', committed: true }),
    ])
    expect(result.errors).toEqual([])
  })
})
