import { describe, it, expect } from 'vitest'
import {
  bindClaimPrerequisites,
  bindScenarioPrerequisites,
  scenarioCasePrerequisiteProblems,
  partitionFlowPrerequisites,
} from '../../packages/guard-generator/src/prerequisites.js'
import type { GuardFlow, GuardScenario, GuardVerification } from '@truecourse/shared'
const targets = [
  {
    name: 'currencybeacon',
    aliases: [],
    state: 'unprovided' as const,
    registerIn: 'externals.local.json',
    credentialEnv: ['CURRENCYBEACON_API_KEY'],
  },
]
const verification: GuardVerification = {
  method: 'behavior',
  scope: 'web',
  observable: 'converts and clears',
  cases: [
    { id: 'success', claim: 'conversion succeeds', method: 'behavior', requires: ['browser'], conditions: [],
      prerequisites: [
        { dependency: 'currencybeacon-api-key', mode: 'provided' },
        { dependency: 'currencybeacon-service', mode: 'provided' },
      ] },
    {
      id: 'missing-key',
      claim: 'key missing',
      method: 'behavior',
      requires: ['browser'],
      conditions: [],
      prerequisites: [{ dependency: 'currencybeacon', mode: 'absent' }],
    },
    {
      id: 'crud',
      claim: 'expense saved',
      method: 'behavior',
      requires: ['browser'],
      conditions: [],
      prerequisites: [],
    },
  ],
}
const needs = [
  { kind: 'credential' as const, name: 'currencybeacon-api-key', detail: 'Requires CURRENCYBEACON_API_KEY.' },
  {
    kind: 'external' as const,
    name: 'currencybeacon-service',
    detail: 'The CURRENCYBEACON_API_KEY account must reach the service.',
  },
]
function flow(): GuardFlow {
  return {
    id: 'convert',
    title: 'convert',
    goal: 'convert',
    fingerprint: 'sha256:f',
    synthesisInputsHash: 's',
    composedOf: [],
    bindings: [],
    milestones: [
      {
        order: 1,
        doc: 'spec.md',
        anchor: 'convert',
        claimTitle: 'Convert',
        proofDrivers: ['web'],
        verification: bindClaimPrerequisites(structuredClone(verification), needs, targets),
      },
    ],
  }
}
function scenario(check: string): GuardScenario {
  return {
    id: 'test',
    title: 'test',
    binds: [],
    steps: [{ driver: 'web', expect: { text: { contains: 'Converted' } }, milestone: 1, checks: [check] }],
  }
}
describe('generation prerequisite retention', () => {
  it('does not spread a claim-wide account need to cases that did not declare it', () => {
    const mixed = structuredClone(verification)
    mixed.cases!.push({ id: 'legacy-independent', claim: 'Read the expense', method: 'behavior', requires: ['browser'], conditions: [] })
    const bound = bindClaimPrerequisites(mixed, needs, targets)!
    expect(bound.cases!.find(c => c.id === 'legacy-independent')!.prerequisites).toEqual([])
    expect(bound.cases!.find(c => c.id === 'success')!.prerequisites).toHaveLength(2)
  })
  it('reports controlled-response capability gaps without inventing an account requirement', () => {
    const mixed = flow()
    mixed.milestones[0].verification!.cases!.push({
      id: 'controlled-error', claim: 'A controlled provider error is displayed', method: 'behavior',
      requires: ['browser', 'request-control'], conditions: ['request-failure'], prerequisites: [],
    })
    const partition = partitionFlowPrerequisites(mixed, 'web', targets, { build: 'true', entry: ['node'] })
    expect(partition.flow.milestones[0].verification!.cases!.map(c => c.id)).toEqual(['missing-key', 'crud'])
    const controlled = partition.gaps.filter(g => g.obligations?.some(o => o.caseId === 'controlled-error'))
    expect(controlled).toHaveLength(1)
    expect(controlled[0].blocker).toEqual({ kind: 'unsupported-capability', capabilities: ['request-control'] })
    expect(partition.gaps.find(g => g.obligations?.some(o => o.caseId === 'success'))!.blocker?.dependencies).toEqual(['currencybeacon'])
  })
  it('keeps a missing capability visible even when the same case requires a live account', () => {
    const mixed = flow()
    mixed.milestones[0].verification!.cases![0].requires.push('request-control')
    const partition = partitionFlowPrerequisites(mixed, 'web', targets, { build: 'true', entry: ['node'] })
    const blocked = partition.gaps.filter(g => g.obligations?.some(o => o.caseId === 'success'))
    expect(blocked.map(g => g.blocker?.kind)).toEqual(['unsupported-capability', 'configuration'])
    const registered = partitionFlowPrerequisites(mixed, 'web', [{ ...targets[0], state: 'provided' }], { build: 'true', entry: ['node'] })
    expect(registered.gaps.filter(g => g.obligations?.some(o => o.caseId === 'success')).map(g => g.blocker?.kind)).toEqual(['unsupported-capability'])
    expect(registered.flow.milestones[0].verification!.cases!.map(c => c.id)).not.toContain('success')
  })
  it('retains both incident aliases through case binding even if YAML needs is omitted', () => {
    const bound = bindScenarioPrerequisites(flow(), scenario('success'), targets)
    expect(bound.needs).toEqual(['currencybeacon'])
    expect(bound.prerequisites?.flatMap((p) => p.originalNames ?? [])).toEqual([
      'currencybeacon-api-key',
      'currencybeacon-service',
    ])
    expect(scenarioCasePrerequisiteProblems(flow(), scenario('success'), targets)).toHaveLength(2)
  })
  it('preserves independent account-free and explicitly absent cases', () => {
    expect(bindScenarioPrerequisites(flow(), scenario('crud'), targets).needs).toBeUndefined()
    const absent = bindScenarioPrerequisites(
      flow(),
      { ...scenario('missing-key'), setup: { env: { CURRENCYBEACON_API_KEY: '' } } },
      targets,
    )
    expect(absent.needs).toEqual([])
    expect(scenarioCasePrerequisiteProblems(flow(), absent, [{ ...targets[0], state: 'provided' }])).toEqual([])
  })
  it('binds a name that IS a declared identifier and leaves an unknown one alone', () => {
    const result = bindClaimPrerequisites(
      verification,
      needs.map((n) => ({ ...n, detail: undefined })),
      targets,
    )
    expect(result?.cases?.[0].prerequisites?.map((p) => p.dependency)).toEqual([
      'currencybeacon',
      'currencybeacon-service',
    ])
  })
  it('rewrites a spelling variant to the declared name at the fold', () => {
    const variant = structuredClone(verification)
    variant.cases![1].prerequisites = [{ dependency: 'CurrencyBeacon', mode: 'absent' }]
    const bound = bindClaimPrerequisites(variant, [], targets)!
    expect(bound.cases![1].prerequisites).toEqual([
      { dependency: 'currencybeacon', mode: 'absent', originalNames: ['CurrencyBeacon'] },
    ])
  })
  it('gates an unresolvable prerequisite of any mode out of matching', () => {
    const unknown = flow()
    unknown.milestones[0].verification!.cases = [
      { id: 'missing-key', claim: 'key missing', method: 'behavior', requires: ['browser'], conditions: [],
        prerequisites: [{ dependency: 'Stripe', mode: 'absent' }] },
    ]
    const partition = partitionFlowPrerequisites(unknown, 'web', targets, { build: 'true', entry: ['node'] })
    expect(partition.flow.milestones).toEqual([])
    expect(partition.gaps).toHaveLength(1)
    expect(partition.gaps[0]).toMatchObject({
      kind: 'blocked-on',
      obligations: [{ milestone: 1, caseId: 'missing-key' }],
      blocker: { kind: 'generation' },
    })
    expect(partition.gaps[0].reason).toContain('Prerequisite Stripe (absent) matches no declared dependency')
    // The declared spelling still passes: only a dangling name is gated.
    expect(partitionFlowPrerequisites(flow(), 'web', targets, { build: 'true', entry: ['node'] })
      .flow.milestones[0].verification!.cases!.map((c) => c.id)).toEqual(['missing-key', 'crud'])
  })
  it.each(['command', 'boot'] as const)('does not accept a %s environment as scenario-wide credential absence', (kind) => {
    const step = (value: string): GuardScenario['steps'][number] => kind === 'command'
      ? { run: ['--version'], env: { CURRENCYBEACON_API_KEY: value } }
      : { boot: { env: { CURRENCYBEACON_API_KEY: value } } }
    const absent = scenario('missing-key')
    absent.steps.unshift(step(''))
    const provided = [{ ...targets[0], state: 'provided' as const }]
    expect(scenarioCasePrerequisiteProblems(flow(), absent, provided)[0]?.reason).toContain('setup.env')
    absent.setup = { env: { CURRENCYBEACON_API_KEY: '' } }
    expect(scenarioCasePrerequisiteProblems(flow(), absent, provided)).toEqual([])
    absent.steps.unshift(step('restored'))
    expect(scenarioCasePrerequisiteProblems(flow(), absent, provided)[0]?.reason).toContain('setup.env')
  })
})

describe('regeneration after account setup', () => {
  it('retains independent proof, blocks legacy needs aliases, then derives omitted YAML bindings after registration', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const h = await import('./helpers.js')
    const { externalsLocalPath, loadScenarios, readManifest, readGuardClaimsCorpus } =
      await import('@truecourse/guard-runner')
    const repoRoot = h.makeTempRepo()
    try {
      h.writeCorpus(repoRoot, [{ ref: 'docs/spec.md' }])
      h.writeDoc(
        repoRoot,
        'docs/spec.md',
        '## version\nThe version prints.\n## conversion\nCurrency conversion needs a supplied account.\n## observation\nUpstream calls are observable.',
      )
      h.writeRecipe(repoRoot, {
        api: {
          serve: ['node', 'unused.js'],
          externals: {
            currencybeacon: {
              baseUrlEnv: 'CURRENCYBEACON_BASE_URL',
              baseUrl: 'http://127.0.0.1:9999',
              env: { CURRENCYBEACON_API_KEY: {} },
            },
          },
        },
      })
      const caseOf = (id: string, prerequisites?: typeof needs) => ({
        claim: id,
        verification: {
          method: 'behavior' as const,
          scope: 'configuration' as const,
          observable: 'The version prints',
          cases: [{ id, claim: id, method: 'behavior' as const, requires: ['process' as const], conditions: [],
            prerequisites: prerequisites?.map((n) => ({ dependency: n.name, mode: 'provided' as const })) ?? [] }],
        },
        ...(prerequisites ? { needs: prerequisites } : {}),
      })
      const extractSession = h.extractSessionBy({
        version: [caseOf('crud')],
        conversion: [caseOf('live', needs)],
        observation: [
          {
            claim: 'Calls observable',
            verification: {
              method: 'behavior',
              scope: 'configuration',
              observable: 'Requests',
              cases: [
                {
                  id: 'outbound',
                  claim: 'No outbound call',
                  method: 'behavior',
                  requires: ['request-control'],
                  conditions: [],
                },
              ],
            },
          },
        ],
      })
      let workerCalls: string[] = []
      const worker = h.flowWorkerSessionOf(async (task) => {
        workerCalls.push(task.flowId)
        const id = task.flowId === 'version' ? 'crud' : 'live'
        const yaml = h.scenarioYaml(
          h.raw('Check ' + id, [
            { run: ['--version'], milestone: 1, checks: [id], expect: { stdout: { contains: '2.4.1' } } },
          ]),
        )
        const report = await task.submitScenario(yaml, [], async () => ({
          kind: 'faithful',
          evidence: [{ milestone: 1, caseId: id, steps: [1], reason: 'Checks the configured fixture output.' }],
        }))
        expect(report.isError, report.content).not.toBe(true)
        return {
          kind: 'outcome',
          outcome: { kind: 'settled', scenarioYamlSha: h.acceptedSha(report)!, expectedReds: [] },
        }
      })
      const first = await h.runGenerate({ repoRoot, extractSession, flowWorkerSession: worker })
      expect(workerCalls).toEqual(['version'])
      expect(first.written).toHaveLength(1)
      expect(first.coverageGaps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            blocker: expect.objectContaining({ kind: 'configuration', dependencies: ['currencybeacon'] }),
          }),
          expect.objectContaining({ blocker: expect.objectContaining({ kind: 'unsupported-capability' }) }),
        ]),
      )
      expect(
        readGuardClaimsCorpus(repoRoot)?.claims.find((c) => c.anchor === 'conversion')?.verification?.cases?.[0]
          .prerequisites?.[0].dependency,
      ).toBe('currencybeacon')
      fs.writeFileSync(
        externalsLocalPath(repoRoot),
        JSON.stringify({ currencybeacon: { env: { CURRENCYBEACON_API_KEY: 'fixture-account' } } }),
      )
      workerCalls = []
      const second = await h.runGenerate({ repoRoot, extractSession, flowWorkerSession: worker })
      expect(workerCalls).toEqual(['conversion'])
      expect(second.written).toHaveLength(1)
      const generated = loadScenarios(repoRoot).scenarios.find((s) => s.flow?.id === 'conversion')!
      expect(generated.needs).toEqual(['currencybeacon'])
      expect(generated.prerequisites?.[0].dependency).toBe('currencybeacon')
      expect(readManifest(repoRoot)?.flows.find((f) => f.flowId === 'version')?.scenarios).toHaveLength(1)
    } finally {
      h.rmrf(repoRoot)
    }
  })
})

describe('provider cases reach matching without live account requirements', () => {
  const providerTargets = [{ ...targets[0], providers: [{ service: 'currencybeacon', baseUrlEnvs: ['CURRENCYBEACON_BASE_URL'] }] }]
  const recipe = { web: { serve: ['node', 'app.js'] }, api: { externals: { currencybeacon: { baseUrlEnv: 'CURRENCYBEACON_BASE_URL' } } } }
  function controlledFlow(): GuardFlow {
    const f = flow()
    f.milestones[0].verification = { method: 'behavior', scope: 'web', observable: 'controlled rate', cases: [
      { id: 'rate', claim: 'rate controls total', method: 'behavior', requires: ['browser', 'provider-control'], conditions: [], prerequisites: [], providerControls: [{ service: 'CurrencyBeacon', operations: ['response'] }] },
      { id: 'loading', claim: 'loading while own request pending', method: 'behavior', requires: ['browser', 'own-request-control'], conditions: ['request-pending'], prerequisites: [] },
    ] }
    f.milestones[0].verification = bindClaimPrerequisites(f.milestones[0].verification, needs, providerTargets)
    return f
  }
  it('keeps only the provider case and preserves its canonical metadata', () => {
    const result = partitionFlowPrerequisites(controlledFlow(), 'web', providerTargets, recipe)
    expect(result.flow.milestones[0].verification?.cases?.map(c => c.id)).toEqual(['rate'])
    expect(result.flow.milestones[0].verification?.cases?.[0]).toMatchObject({ prerequisites: [], providerControls: [{ service: 'currencybeacon', operations: ['response'], originalNames: ['CurrencyBeacon'] }] })
    expect(result.gaps).toHaveLength(1)
    expect(result.gaps[0]).toMatchObject({ obligations: [{ milestone: 1, caseId: 'loading' }], blocker: { kind: 'unsupported-capability', capabilities: ['own-request-control'] } })
  })
  it('reports an undeclared provider wiring gap and rejects replay without a strict script', () => {
    const f = controlledFlow()
    const result = partitionFlowPrerequisites(f, 'web', targets, recipe)
    expect(result.flow.milestones).toEqual([])
    expect(result.gaps.find(g => g.obligations?.[0].caseId === 'rate')?.reason).toContain('no declared external')
    expect(scenarioCasePrerequisiteProblems(f, scenario('rate'), providerTargets, {}, recipe).map(p => p.reason).join()).toContain('CURRENCYBEACON_BASE_URL')
  })
})

it('rejects saved provider-counter evidence for an ambiguous or browser-to-app case during reuse and authoring', () => {
  const f = flow()
  f.milestones[0].verification!.cases = [{ id: 'count', claim: 'Clicking Convert calls the conversion endpoint once', method: 'behavior', requires: ['browser', 'provider-control'], conditions: [], providerControls: [{ service: 'currencybeacon', operations: ['call-count'] }] }]
  expect(scenarioCasePrerequisiteProblems(f, scenario('count'), targets)[0].reason).toContain('Re-extract')
  f.milestones[0].verification!.cases[0].requestBoundary = 'browser-to-app'
  f.milestones[0].verification!.cases[0].requires.push('own-request-control')
  expect(scenarioCasePrerequisiteProblems(f, scenario('count'), targets)[0].reason).toContain('own-request-control')
})
