import { describe, it, expect } from 'vitest'
import {
  GuardGenerateReportSchema,
  GuardCoverageGapSchema,
  GuardCoverageGapKindSchema,
  GuardBirthFindingSchema,
  emptyGapDisplayTotals,
  gapDisplayKind,
  isCompositionFinding,
  type GuardBirthFinding,
} from '@truecourse/shared'

/** A minimal valid report — every flow-led field below is additive on top of it. */
const BASE = {
  generatedAt: '2026-07-25T00:00:00.000Z',
  status: 'ok' as const,
  sectionsTotal: 3,
  sectionsChanged: 1,
  skippedUnchanged: 2,
  noChanges: false,
  written: [],
  coverageGaps: [],
  birthFindings: [],
  errors: [],
  extractionFailures: [],
  orphaned: [],
}

describe('guard report — the realization gap kinds', () => {
  it('carries `no-journey` and `unrealizable` as first-class kinds', () => {
    expect(GuardCoverageGapKindSchema.options).toContain('no-journey')
    expect(GuardCoverageGapKindSchema.options).toContain('unrealizable')
  })

  it('a flow-level gap names its flow and surface without claiming a driver', () => {
    const gap = GuardCoverageGapSchema.parse({
      doc: 'docs/tasks.md',
      anchor: 'tasks/creating',
      kind: 'no-journey',
      reason: 'no cli journey was mapped from this repository',
      flowId: 'task-lifecycle',
      surface: 'cli',
    })
    expect(gap.flowId).toBe('task-lifecycle')
    expect(gap.surface).toBe('cli')
    // `driver` stays reserved for awaiting-driver gaps — the refine still holds.
    expect(() =>
      GuardCoverageGapSchema.parse({ ...gap, driver: 'cli' }),
    ).toThrow()
  })

  it('both kinds paint under their own display key and count separately', () => {
    const totals = emptyGapDisplayTotals()
    expect(totals['no-journey']).toBe(0)
    expect(totals.unrealizable).toBe(0)
    const gap = GuardCoverageGapSchema.parse({
      doc: 'd',
      anchor: 'a',
      kind: 'unrealizable',
      reason: 'no journey path serves milestone 2',
    })
    expect(gapDisplayKind(gap)).toBe('unrealizable')
  })

  it('an awaiting-driver gap still keys by its driver, never by the kind', () => {
    const gap = GuardCoverageGapSchema.parse({
      doc: 'd',
      anchor: 'a',
      kind: 'awaiting-driver',
      driver: 'web',
      reason: 'Needs web driver',
      flowId: 'task-lifecycle',
      surface: 'web',
    })
    expect(gapDisplayKind(gap)).toBe('web')
  })
})

describe('guard findings — the composition-triage pair', () => {
  const finding = (extra: Partial<GuardBirthFinding>): GuardBirthFinding =>
    GuardBirthFindingSchema.parse({
      doc: 'docs/tasks.md',
      anchor: 'tasks/completing',
      title: 'the task lifecycle',
      step: 3,
      expected: 'exit 0',
      actual: 'exit 7',
      flowId: 'task-lifecycle',
      surface: 'cli',
      ...extra,
    })

  it('a MID-CHAIN break is the "milestones don’t chain" category', () => {
    expect(isCompositionFinding(finding({ failedMilestone: 3, priorMilestonesPassed: true }))).toBe(true)
  })

  it('a failure at the head of the path is ordinary doc-vs-code drift', () => {
    expect(isCompositionFinding(finding({ failedMilestone: 1, priorMilestonesPassed: false }))).toBe(false)
    // A later milestone whose predecessors never ran is not a chain break either.
    expect(isCompositionFinding(finding({ failedMilestone: 3, priorMilestonesPassed: false }))).toBe(false)
  })

  it('a fidelity finding is never a composition finding (no run, no chain)', () => {
    expect(
      isCompositionFinding(finding({ kind: 'fidelity', failedMilestone: 3, priorMilestonesPassed: true })),
    ).toBe(false)
  })

  it('an un-annotated finding (hand-written work, older reports) reads as ordinary', () => {
    expect(isCompositionFinding(finding({}))).toBe(false)
  })
})

describe('guard report — flow-led counts', () => {
  it('round-trips the flows + journeys blocks', () => {
    const report = GuardGenerateReportSchema.parse({
      ...BASE,
      written: [
        {
          id: 'task-lifecycle.cli.1',
          title: 'the task lifecycle',
          doc: 'docs/tasks.md',
          anchor: 'tasks/creating',
          file: '.truecourse/scenarios/tasks/task-lifecycle.cli.1.yaml',
          flowId: 'task-lifecycle',
          surface: 'cli',
        },
      ],
      flows: {
        total: 6,
        settled: 5,
        unsettled: 1,
        skipped: 3,
        dismissed: 1,
        orphaned: 0,
        subsumed: 2,
        noFlowClaims: 4,
        unsettledAreas: [{ areaId: 'billing', reason: 'flow synthesis invalid after re-ask' }],
      },
      journeys: { total: 12, bySurface: { cli: 12 } },
      orphanedFlowDismissals: [{ flowId: 'gone', title: 'a recomposed flow' }],
    })

    expect(report.flows!.settled + report.flows!.unsettled).toBe(report.flows!.total)
    expect(report.flows!.skipped).toBeLessThanOrEqual(report.flows!.settled)
    expect(report.journeys!.bySurface.cli).toBe(12)
    expect(report.written[0].flowId).toBe('task-lifecycle')
  })

  it('a report written before flows existed still parses (every field optional)', () => {
    expect(() => GuardGenerateReportSchema.parse(BASE)).not.toThrow()
  })

  it('unsettledAreas defaults to empty so a partial flows block is readable', () => {
    const report = GuardGenerateReportSchema.parse({
      ...BASE,
      flows: {
        total: 1,
        settled: 1,
        unsettled: 0,
        skipped: 0,
        dismissed: 0,
        orphaned: 0,
        subsumed: 0,
        noFlowClaims: 0,
      },
    })
    expect(report.flows!.unsettledAreas).toEqual([])
  })
})
