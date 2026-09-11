import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GuardExecutor } from '@truecourse/guard-runner'
import { readManifest } from '@truecourse/guard-runner'
import type { FlowWorkerReview, WorkerFidelityJudge } from '@truecourse/guard-generator'
import { interfaceFingerprint, type GuardExpectedRed, type GuardFailureObservation, type GuardFlowWorkerOutcome, type GuardScenarioResult, type Interface } from '@truecourse/shared'
import { flowWorkerSystemPrompt } from '../../packages/core/src/services/guard-generate/flow-worker.js'
import { acceptedSha, extractSessionBy, flowWorkerSessionOf, interfacesOf, makeTempRepo, rawWeb, rmrf,
  runGenerate, scenarioYaml, writeCorpus, writeDoc, writeRecipe } from './helpers.js'

const repos: string[] = []
afterEach(() => { while (repos.length) rmrf(repos.pop()!) })
const obs: GuardFailureObservation = { version: 1, kind: 'web-target', assertion: 'visible:0',
  page: 'guard-server://web/', operation: 'to see', locator: { role: 'button', name: 'Save' },
  matchCount: 0, visibility: 'hidden', reason: 'absent' }
const yaml = scenarioYaml(rawWeb('Save is visible', [{ driver: 'web', navigate: '/', milestone: 1,
  checks: ['save'], expect: { visible: { role: 'button', name: 'Save' } } }]))
const prediction = (id?: string): GuardExpectedRed => ({ step: 1, predictedActual: 'Save is absent',
  verdict: 'code-drift', brief: 'The required Save action is absent.', ...(id ? { observationId: id } : {}) })
const observationId = (report: { content: string }): string => /observationId: (\S+)/.exec(report.content)?.[1] ?? ''
const acceptedOutcome = (report: { content: string }): GuardFlowWorkerOutcome => JSON.parse(/Finish with: (.*)/.exec(report.content)![1])
const judge: WorkerFidelityJudge = async () => ({ kind: 'faithful', evidence: [{ milestone: 1, caseId: 'save', steps: [1], reason: 'The visible Save assertion directly checks the required action.' }] })

function action(id: string, title = id): Interface {
  const shape = { type: 'web' as const, entry: { command: ['/'] }, steps: [{ kind: 'navigate' as const, route: '/' }] }
  return { ...shape, id, title, fingerprint: interfaceFingerprint(shape) }
}
function seed() {
  const repoRoot = makeTempRepo(); repos.push(repoRoot)
  writeRecipe(repoRoot, { web: { serve: ['node', 'unused-fixture.mjs'] } })
  writeCorpus(repoRoot, [{ ref: 'docs/app.md' }])
  writeDoc(repoRoot, 'docs/app.md', '## home\nThe home page has a visible Save button.')
  return repoRoot
}
function options(repoRoot: string) {
  return { repoRoot, interfaces: interfacesOf(repoRoot, action('web/home', 'Home')),
    browserPreflight: async () => ({ ok: true as const }),
    extractSession: extractSessionBy({ home: [{ driver: 'web', verification: {
      scope: 'web', method: 'behavior', observable: 'Save action',
      cases: [{ id: 'save', claim: 'Save is visible', method: 'behavior', requires: ['browser'], conditions: [] }],
    } }] }),
  }
}
function executor(override: () => Partial<GuardScenarioResult> = () => ({})): GuardExecutor {
  let calls = 0
  return async input => {
    calls++
    const scenarios = input.scenarios.map(s => ({ id: s.id, title: s.title, binds: s.binds[0],
      outcome: 'fail' as const, durationMs: 5,
      failure: { step: 1, expected: 'Save visible', actual: calls % 2 ? 'no element with text Save' : 'nothing on the page matches Save', observation: obs },
      ...override(),
    }))
    return { status: 'ok', latestPath: '', loadErrors: [], manifest: null,
      latest: { run: { runId: `offline-${calls}`, ranAt: '2026-09-11T00:00:00Z', branch: null, commit: null, recipeFingerprint: 'fixture' },
        summary: { total: scenarios.length, pass: 0, fail: scenarios.length, error: 0, stale: 0, orphaned: 0, blocked: 0 }, scenarios, sections: [] },
    }
  }
}

describe('web execution evidence through authoring and confirmation', () => {
  it('finds a late setup action and accepts a complete reviewed red, with canonical evidence protected from outcome edits', async () => {
    const repoRoot = seed()
    const review = vi.fn(judge)
    const res = await runGenerate({ ...options(repoRoot), executor: executor(),
      interfaces: interfacesOf(repoRoot, action('web/home', 'Home'), ...Array.from({ length: 1200 }, (_, i) => action(`web/other-${i}`, `Unrelated ${i}`)), action('web/z-setup', 'Special setup')),
      matchRunner: async ctx => ({ plan: ctx.milestones.map(m => ({ interfaceId: 'web/home', milestone: m.order, checks: ['save'] })) }),
      flowWorkerSession: flowWorkerSessionOf(async task => {
        const briefing = await task.prepare()
        expect(Buffer.byteLength(flowWorkerSystemPrompt('web') + briefing)).toBeLessThanOrEqual(120_000)
        expect(briefing).not.toContain('web/z-setup')
        const search = task.catalog!.search({ query: 'Special setup' })
        expect(search.isError).not.toBe(true)
        expect(search.content).toContain('web/z-setup')
        const fetched = task.catalog!.get({ ids: ['web/z-setup'] })
        expect(fetched.content.length).toBeLessThanOrEqual(12_000)
        expect(fetched.content).toContain('navigate')
        const probe = await task.runScenario(yaml)
        const id = observationId(probe)
        expect(id).toBeTruthy()
        const accepted = await task.submitScenario(yaml, [prediction(id)], review)
        expect(accepted.isError, accepted.content).not.toBe(true)
        const outcome = acceptedOutcome(accepted)
        expect(outcome.expectedReds![0].observation).toEqual(obs)
        expect(outcome.expectedReds![0].observationId).toBeUndefined()
        expect(task.validateOutcome({ ...outcome, expectedReds: [prediction()] })).toContain('canonical evidence')
        expect(task.validateOutcome(outcome)).toBeUndefined()
        return { kind: 'outcome', outcome }
      }),
    })
    expect(res.errors).toEqual([])
    expect(res.written).toHaveLength(1)
    expect(review).toHaveBeenCalledOnce()
    expect(readManifest(repoRoot)!.flows[0].scenarios[0].caseEvidence).toHaveLength(1)
    expect(readManifest(repoRoot)!.flows[0].scenarios[0].diagnosis!.expectedRed!.observation).toEqual(obs)
  })

  it('rejects missing, forged and changed-candidate IDs and semantic changes without relaxing review', async () => {
    const repoRoot = seed()
    let changed = false
    const review = vi.fn(judge)
    await runGenerate({ ...options(repoRoot), executor: executor(() => changed ? {
      failure: { step: 1, expected: 'Save visible', actual: 'Save is absent', observation: { ...obs, page: 'guard-server://web/login' } },
    } : {}), flowWorkerSession: flowWorkerSessionOf(async task => {
      const id = observationId(await task.runScenario(yaml))
      for (const [draft, reds] of [[yaml, [prediction()]], [yaml, [prediction('forged')]], [yaml + '\n', [prediction(id)]], [yaml, [prediction(id), prediction(id)]]] as const) {
        const report = await task.submitScenario(draft, reds, review)
        expect(report.isError, report.content).toBe(true)
      }
      changed = true
      expect((await task.submitScenario(yaml, [prediction(id)], review)).isError).toBe(true)
      expect(review).not.toHaveBeenCalled()
      return { kind: 'failed', reason: 'negative evidence fixtures' }
    }) })
    expect(readManifest(repoRoot)!.flows[0].scenarios).toEqual([])
  })

  it('reconfirms cached typed reds, refuses legacy evidence, and retains fresh fidelity requirements', async () => {
    const repoRoot = seed()
    await runGenerate({ ...options(repoRoot), executor: executor(), flowWorkerSession: flowWorkerSessionOf(async task => {
      const id = observationId(await task.runScenario(yaml))
      const accepted = await task.submitScenario(yaml, [prediction(id)], judge)
      const sha = acceptedSha(accepted)!
      expect(sha, accepted.content).toBeTruthy()
      const outcome = acceptedOutcome(accepted)
      const cached = { yaml: task.stashedYaml(sha)!, expectedReds: outcome.expectedReds!, review: task.stashedReview(sha) as FlowWorkerReview }
      expect(await task.confirmCached([{ ...cached, expectedReds: [prediction()] }])).toBe(false)
      expect(await task.confirmCached([{ ...cached, review: undefined }])).toBe(false)
      expect(await task.confirmCached([cached])).toBe(true)
      return { kind: 'outcome', outcome }
    }) })
    expect(readManifest(repoRoot)!.flows[0].scenarios).toHaveLength(1)
  })
})
