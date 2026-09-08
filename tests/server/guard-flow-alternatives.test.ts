import { describe, expect, it } from 'vitest'
import { composeDocCoverage, type GuardCoverageSources } from '../../packages/core/src/commands/guard-read.js'
import {
  GuardManifestSchema, GuardFlowsFileSchema, GuardGenerateReportSchema, GuardScenarioSchema, GuardLatestSchema,
  coversFlowMilestones, scenarioMilestoneProof, flowFingerprint,
  type GuardFlowMilestone,
} from '@truecourse/shared'

const doc = 'docs/spec.md'
const content = '# Expenses\nAdd and edit expenses.'
const milestones: GuardFlowMilestone[] = [1, 2].map((order) => ({
  order, doc, anchor: 'expenses', claimTitle: `Expense milestone ${order}`, proofDrivers: ['web', 'api'],
}))
function sources(ms = milestones): GuardCoverageSources {
  const fingerprint = flowFingerprint(ms)
  const bindings = [{ doc, anchor: 'expenses', fingerprint: 'sha256:section' }]
  return {
    latest: null, result: null,
    flows: GuardFlowsFileSchema.parse({ version: 1, generatedAt: '2026-09-08T00:00:00Z', flows: [{
      id: 'expenses', title: 'Expenses', goal: 'Manage expenses', fingerprint, milestones: ms, bindings, composedOf: [], synthesisInputsHash: 'sha256:inputs',
    }], noFlowClaims: [] }),
    manifest: GuardManifestSchema.parse({ flows: [{
      flowId: 'expenses', flowFingerprint: fingerprint, milestones: ms, bindings,
      scenarios: [{ id: 'expenses.web', drivers: ['web'], status: 'passing', milestoneCoverage: ms.map((m) => ({ milestone: m.order, driver: 'web' })) }],
      gaps: [{ surface: 'api', kind: 'no-interface', reason: 'No API interfaces mapped' }],
    }] }),
  }
}
function read(s: GuardCoverageSources) {
  const section = composeDocCoverage(doc, content, s).sections[0]
  return { section, flow: section.flows[0] }
}

describe('coverage across alternative flow proofs', () => {
  it('a successful full web proof settles the flow while keeping the unavailable API alternative visible', () => {
    const { section, flow } = read(sources())
    expect(flow.status).toBe('guarded')
    expect(section.status).toBe('guarded')
    expect(flow.surfaces.find((s) => s.gap)).toMatchObject({ status: 'no-interface', coveredByAlternative: true })
  })

  it.each(['no-interface', 'unrealizable', 'blocked-on', 'awaiting-driver'] as const)('settles an alternative %s only with full proof', (kind) => {
    const s = sources()
    s.manifest!.flows[0].gaps = [{ surface: 'api', kind, reason: 'Unavailable alternative', ...(kind === 'awaiting-driver' ? { driver: 'api' as const } : {}) }]
    expect(read(s).flow.status).toBe('guarded')
    s.manifest!.flows[0].scenarios[0].milestoneCoverage!.pop()
    expect(read(s).flow.surfaces.find((r) => r.gap)?.coveredByAlternative).toBeUndefined()
    expect(read(s).flow.status).not.toBe('guarded')
  })

  it('keeps a mandatory API promise unmet even if a web test tags every milestone', () => {
    const s = sources([milestones[0], { ...milestones[1], proofDrivers: ['api'] }])
    const { flow } = read(s)
    expect(flow.status).toBe('no-interface')
    expect(flow.surfaces[0].coverageComplete).toBe(false)
  })

  it('does not let a passing partial scenario claim complete coverage, even without gaps', () => {
    const s = sources()
    s.manifest!.flows[0].gaps = []
    s.manifest!.flows[0].scenarios[0].milestoneCoverage!.pop()
    expect(read(s).flow.status).toBe('unguarded')
  })

  it.each(['failing', 'never-run'] as const)('never lets %s scenarios discharge an alternative', (status) => {
    const s = sources(); s.manifest!.flows[0].scenarios[0].status = status
    expect(read(s).flow.status).toBe(status === 'failing' ? 'fail' : 'no-interface')
  })

  it('keeps a failing test visible alongside a complete passing alternative', () => {
    const s = sources()
    s.manifest!.flows[0].scenarios.push({ id: 'expenses.api', drivers: ['api'], status: 'failing' })
    expect(read(s).flow.status).toBe('fail')
  })

  it('preserves unrelated gaps', () => {
    const s = sources()
    s.manifest!.flows[0].gaps.push({ surface: 'cli', kind: 'no-interface', reason: 'A separate CLI obligation' })
    expect(read(s).flow.status).toBe('no-interface')
  })

  it('uses manifest requirements without flows.json, and keeps legacy manifests conservative', () => {
    const s = sources(); s.flows = null
    expect(read(s).flow.status).toBe('guarded')
    delete s.manifest!.flows[0].milestones
    delete s.manifest!.flows[0].scenarios[0].milestoneCoverage
    expect(read(s).flow.status).toBe('no-interface')
    expect(GuardManifestSchema.safeParse(s.manifest).success).toBe(true)
  })

  it('does not reuse proof of an older flow composition', () => {
    const s = sources(); s.manifest!.flows[0].flowFingerprint = 'sha256:old'
    expect(read(s).flow.status).toBe('no-interface')
  })

  it('does not infer completion from manifest driver presence when assertion metadata is missing', () => {
    const s = sources(); delete s.manifest!.flows[0].scenarios[0].milestoneCoverage
    expect(read(s).flow.status).toBe('no-interface')
  })

  it.each(['pass', 'fail', 'error', 'stale', 'blocked'] as const)('uses the current %s verdict rather than a passing birth', (outcome) => {
    const s = sources()
    s.latest = GuardLatestSchema.parse({
      run: { runId: 'run', ranAt: '2026-09-08T00:00:00Z', branch: 'main', commit: 'abc', recipeFingerprint: 'sha256:recipe' },
      summary: { total: 1, pass: 0, fail: 0, error: 0, stale: 0, orphaned: 0 }, sections: [],
      scenarios: [{ id: 'expenses.web', title: 'Expenses', outcome, durationMs: 1, flowId: 'expenses', binds: { doc, section: 'expenses', fingerprint: 'sha256:section' } }],
    })
    expect(read(s).flow.status).toBe(outcome)
    expect(read(s).flow.surfaces.find((r) => r.gap)?.coveredByAlternative).toBe(outcome === 'pass' ? true : undefined)
  })

  it('supports report-only gaps using current committed scenario assertions', () => {
    const s = sources()
    const flow = s.flows!.flows[0]
    s.scenarios = [GuardScenarioSchema.parse({
      id: 'expenses.web', title: 'Manage expenses', flow: { id: flow.id, fingerprint: flow.fingerprint },
      binds: [{ doc, section: 'expenses', fingerprint: 'sha256:section' }],
      steps: milestones.map((m) => ({ driver: 'web', navigate: '/expenses', milestone: m.order, expect: { visible: { role: 'heading', name: 'Expenses' } } })),
    })]
    s.result = GuardGenerateReportSchema.parse({
      generatedAt: '2026-09-08T00:00:00Z', status: 'ok', sectionsTotal: 1, sectionsChanged: 1, skippedUnchanged: 0, noChanges: false,
      written: [{ id: 'expenses.web', title: 'Expenses', doc, anchor: 'expenses', file: '.truecourse/scenarios/expenses.web.yaml', status: 'passing' }], coverageGaps: [{ doc, anchor: 'expenses', flowId: 'expenses', surface: 'api', kind: 'no-interface', reason: 'No API mapping' }],
      birthFindings: [], errors: [], extractionFailures: [], orphaned: [],
    })
    s.manifest = null
    expect(read(s).flow.status).toBe('guarded')
    const written = s.result.written
    s.result.written = []
    expect(read(s).flow.status).toBe('no-interface')
    expect(read(s).flow.surfaces[0].status).toBe('never-run')
    s.result.written = written
    s.result.errors.push({ flowId: 'expenses', surface: 'cli', doc, anchor: 'expenses', kind: 'authoring', message: 'Could not author another required attempt' })
    expect(read(s).flow.status).toBe('authoring-error')
  })

  it('counts assertion drivers per milestone, excluding unasserted actions and unrelated API setup', () => {
    const steps = [
      { request: { method: 'GET', path: '/health' }, expect: { status: 200 } },
      { driver: 'web', navigate: '/expenses', milestone: 1 },
      { driver: 'web', click: { role: 'button', name: 'Save' }, milestone: 2, expect: { visible: { text: 'Saved' } } },
    ]
    const proof = scenarioMilestoneProof(steps)
    expect(proof).toEqual([{ milestone: 2, driver: 'web' }])
    expect(coversFlowMilestones(milestones, proof)).toBe(false)
  })
})
