import { afterEach, describe, expect, it } from 'vitest'
import { readManifest, loadScenarios } from '@truecourse/guard-runner'
import type { GuardExpectedRed } from '@truecourse/shared'
import { acceptedSha, extractSessionBy, faithfulJudge, flowOfAllSession, flowWorkerSessionOf, makeTempRepo,
  raw, rmrf, runGenerate, scenarioYaml, writeCorpus, writeDoc, writeRecipe } from './helpers.js'

const repos: string[] = []
afterEach(() => { while (repos.length) rmrf(repos.pop()!) })
function seed() {
  const r = makeTempRepo(); repos.push(r); writeRecipe(r); writeCorpus(r, [{ ref: 'docs/spec.md' }])
  writeDoc(r, 'docs/spec.md', '## version\nThe CLI reports its version.\n\n## help\nThe CLI explains its usage.')
  return r
}
const yamlFor = (milestone: number) => scenarioYaml(raw(`Verify obligation ${milestone}`, [{ run: ['--version'], milestone, expect: { exit: 0 } }]))

describe('independent scenario coverage survives incomplete flows', () => {
  it('saves a reviewed portion before a later block, with the exact remaining milestone visible', async () => {
    const repoRoot = seed()
    const result = await runGenerate({ repoRoot, flowsAreaSession: flowOfAllSession('Version and help'),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        const report = await task.submitScenario(yamlFor(1), [], async (request) => {
          expect(request.briefing).toContain('--- milestone 1')
          expect(request.briefing).not.toContain('--- milestone 2')
          expect(request.briefing).toContain('FULL FLOW CONTEXT')
          return faithfulJudge(request)
        })
        expect(acceptedSha(report), report.content).not.toBeNull()
        return { kind: 'outcome', outcome: { kind: 'blocked', perMilestone: [{ order: 2, capability: 'controlled failure fixture' }] } }
      }),
    })
    expect(result.written).toHaveLength(1)
    const entry = readManifest(repoRoot)!.flows[0]
    expect(entry.scenarios[0]).toMatchObject({ milestoneCoverage: [{ milestone: 1, driver: 'cli' }] })
    expect(entry.scenarios[0].reviewed).not.toBe(false)
    expect(entry.gaps).toContainEqual(expect.objectContaining({ milestones: [2], kind: 'blocked-on' }))
    expect(entry.generationInputsHash).toBeNull()
    expect(loadScenarios(repoRoot).scenarios).toHaveLength(1)
  })

  it('keeps separate accepted portions with distinct IDs and settles their combined coverage', async () => {
    const repoRoot = seed()
    const result = await runGenerate({ repoRoot, flowsAreaSession: flowOfAllSession('Version and help'),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        const first = acceptedSha(await task.submitScenario(yamlFor(1), [], faithfulJudge))!
        const second = acceptedSha(await task.submitScenario(yamlFor(2), [], faithfulJudge))!
        return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: second, expectedReds: [], additionalScenarios: [{ scenarioYamlSha: first, expectedReds: [] }] } }
      }),
    })
    expect(result.written).toHaveLength(2)
    const entry = readManifest(repoRoot)!.flows[0]
    expect(new Set(entry.scenarios.map((s) => s.id)).size).toBe(2)
    expect(entry.scenarios.flatMap((s) => s.milestoneCoverage).map((p) => p!.milestone).sort()).toEqual([1, 2])
    expect(entry.generationInputsHash).not.toBeNull()
  })

  it('preserves a verified subset when a later candidate fails fidelity and the worker retires', async () => {
    const repoRoot = seed()
    const result = await runGenerate({ repoRoot, flowsAreaSession: flowOfAllSession('Version and help'),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        expect(acceptedSha(await task.submitScenario(yamlFor(1), [], faithfulJudge))).not.toBeNull()
        const weak = await task.submitScenario(yamlFor(2), [], async () => ({ kind: 'flagged', confidence: 'high', mismatch: 'Does not verify help text' }))
        expect(weak.isError).toBe(true)
        return { kind: 'outcome', outcome: { kind: 'retired', attempts: 2, lastEvidence: 'Help assertions remain incomplete' } }
      }),
    })
    expect(result.written).toHaveLength(1)
    expect(readManifest(repoRoot)!.flows[0].generationInputsHash).toBeNull()
    expect(readManifest(repoRoot)!.flows[0].scenarios[0].milestoneCoverage).toEqual([{ milestone: 1, driver: 'cli' }])
  })

  it('adds a later portion without removing an earlier verified scenario', async () => {
    const repoRoot = seed()
    const generatePortion = (milestone: number) => runGenerate({ repoRoot,
      flowsAreaSession: flowOfAllSession('Version and help'),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        const sha = acceptedSha(await task.submitScenario(yamlFor(milestone), [], faithfulJudge))!
        return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: sha, expectedReds: [] } }
      }),
    })
    const first = await generatePortion(1)
    expect(first.written).toHaveLength(1)
    const second = await generatePortion(2)
    expect(second.written).toHaveLength(1)
    expect(second.written[0].id).not.toBe(first.written[0].id)
    const entry = readManifest(repoRoot)!.flows[0]
    expect(entry.scenarios).toHaveLength(2)
    expect(loadScenarios(repoRoot).scenarios).toHaveLength(2)
    expect(entry.gaps).toEqual([])
    expect(entry.generationInputsHash).not.toBeNull()
  })

  it('keeps review status per scenario when another portion cannot be reviewed', async () => {
    const repoRoot = seed()
    const result = await runGenerate({ repoRoot, flowsAreaSession: flowOfAllSession('Version and help'),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        expect(acceptedSha(await task.submitScenario(yamlFor(1), [], faithfulJudge))).not.toBeNull()
        const sha = acceptedSha(await task.submitScenario(yamlFor(2), [], async () => ({ kind: 'unavailable', reason: 'Review transport failed' })))!
        return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: sha, expectedReds: [] } }
      }),
    })
    expect(result.written).toHaveLength(2)
    const entry = readManifest(repoRoot)!.flows[0]
    expect(entry.scenarios.find((s) => s.milestoneCoverage?.[0].milestone === 1)?.reviewed).not.toBe(false)
    expect(entry.scenarios.find((s) => s.milestoneCoverage?.[0].milestone === 2)?.reviewed).toBe(false)
    expect(entry.gaps).toContainEqual(expect.objectContaining({ milestones: [2] }))
    expect(entry.gaps.some((g) => g.milestones?.includes(1))).toBe(false)
    expect(entry.generationInputsHash).toBeNull()
  })

  it('retains a reviewed failing portion while keeping untested obligations retryable', async () => {
    const repoRoot = seed()
    const result = await runGenerate({ repoRoot, flowsAreaSession: flowOfAllSession('Version and help'),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        const yaml = scenarioYaml(raw('Expected zero exit', [{ run: ['boom'], milestone: 1, expect: { exit: 0 } }]))
        const probe = await task.submitScenario(yaml, [], faithfulJudge)
        const predictedActual = /actual:\s+(.*)/.exec(probe.content)?.[1] ?? ''
        const prediction: GuardExpectedRed = { step: 1, predictedActual, verdict: 'code-drift', brief: 'The command exits 7 instead of 0' }
        const sha = acceptedSha(await task.submitScenario(yaml, [prediction], faithfulJudge))!
        expect(sha).not.toBeNull()
        return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: sha, expectedReds: [prediction] } }
      }),
    })
    expect(result.written).toHaveLength(1)
    const entry = readManifest(repoRoot)!.flows[0]
    expect(entry.scenarios[0].status).toBe('failing')
    expect(entry.gaps).toContainEqual(expect.objectContaining({ milestones: [2] }))
    expect(entry.gaps.some((g) => g.milestones?.includes(1))).toBe(false)
    expect(entry.generationInputsHash).toBeNull()
  })

  it('carries verification methods from extraction into persisted milestones and capability gaps', async () => {
    const repoRoot = seed()
    const verification = { method: 'implementation' as const, observable: 'Inspect the numeric parsing implementation' }
    let observableOrder = 0
    const result = await runGenerate({ repoRoot, flowsAreaSession: flowOfAllSession('Version and arithmetic'),
      extractSession: extractSessionBy({ help: [{ claim: 'No floating-point multiplication', verification }] }),
      matchRunner: async (ctx) => {
        observableOrder = ctx.milestones[0].order
        return { plan: ctx.milestones.map((m) => ({ milestone: m.order, interfaceId: ctx.interfaces[0].id })) }
      },
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        const accepted = await task.submitScenario(yamlFor(observableOrder), [], faithfulJudge)
        return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: acceptedSha(accepted)!, expectedReds: [] } }
      }),
    })
    expect(result.written).toHaveLength(1)
    const entry = readManifest(repoRoot)!.flows[0]
    expect(entry.milestones!.find((m) => m.claimTitle.includes('floating'))?.verification).toEqual(verification)
    expect(entry.gaps).toContainEqual(expect.objectContaining({ kind: 'blocked-on', reason: expect.stringContaining('implementation') }))
  })
})
