import { describe, it, expect } from 'vitest'
import {
  bindClaimPrerequisites,
  bindScenarioPrerequisites,
  scenarioCasePrerequisiteProblems,
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
    { id: 'success', claim: 'conversion succeeds', method: 'behavior', requires: ['browser'], conditions: [] },
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
        verification: bindClaimPrerequisites(verification, needs, targets),
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
  it('keeps unresolved aliases actionable rather than guessing suffixes', () => {
    const result = bindClaimPrerequisites(
      verification,
      needs.map((n) => ({ ...n, detail: undefined })),
      targets,
    )
    expect(result?.cases?.[0].prerequisites?.map((p) => p.dependency)).toEqual([
      'currencybeacon-api-key',
      'currencybeacon-service',
    ])
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
          cases: [{ id, claim: id, method: 'behavior' as const, requires: ['process' as const], conditions: [] }],
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
