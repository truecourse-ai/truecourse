import { afterEach, describe, expect, it, vi } from 'vitest'
import { flowFingerprint, type GuardFlow, type GuardFlowMilestone, type Interface } from '@truecourse/shared'
import { buildSurfaceCatalogs, matchFlow, planFlowMatching, readCachedMatch } from '../../packages/guard-generator/src/match.js'
import { MATCH_SYSTEM_PROMPT, buildMatchUserPrompt } from '../../packages/guard-generator/src/prompts.js'
import { makeTempRepo, rmrf } from './helpers.js'

const repos: string[] = []
afterEach(() => { while (repos.length) rmrf(repos.pop()!) })
function repo() { const r = makeTempRepo(); repos.push(r); return r }
const control: Interface = { id: 'web/cancel-add', title: 'Cancel adding', type: 'web', purpose: 'control',
  entry: { method: 'GET', path: '/' }, at: 'add-dialog', to: 'root',
  steps: [{ kind: 'activate', target: 'button "Cancel"', within: { role: 'dialog', name: 'Add expense', exact: true } }],
  fingerprint: 'sha256:cancel' }
const catalog = buildSurfaceCatalogs([control]).get('web')!
function flow(extra: Partial<GuardFlowMilestone> = {}): GuardFlow {
  const milestones: GuardFlowMilestone[] = [1, 2].map((order) => ({ order, doc: 'spec.md', anchor: 'expenses',
    claimTitle: `Obligation ${order}`, proofDrivers: ['web'], ...(order === 2 ? extra : {}) }))
  return { id: 'expenses', title: 'Expenses', goal: 'Manage expenses', fingerprint: flowFingerprint(milestones),
    milestones, bindings: [{ doc: 'spec.md', anchor: 'expenses', fingerprint: 'sha256:spec' }], composedOf: [], synthesisInputsHash: 'inputs' }
}

describe('matching incomplete catalogs and verification capabilities', () => {
  it('keeps grounded portions and round-trips milestone gaps through the cache', async () => {
    const root = repo(); const f = flow()
    const runner = vi.fn(async (ctx) => {
      expect(ctx.interfaces[0].steps[0]).toContain('within')
      expect(ctx.interfaces[0].context).toContain('purpose: control')
      return { plan: [{ interfaceId: control.id, milestone: 1 }], gaps: [{ milestone: 2, kind: 'mapping', reason: 'Pagination action missing from catalog' }] }
    })
    const first = await matchFlow(root, f, catalog, runner)
    expect(first).toMatchObject({ kind: 'plan', gaps: [{ milestone: 2, kind: 'mapping' }], calls: 1 })
    expect(await readCachedMatch(root, f, catalog)).toMatchObject({ plan: { steps: [{ milestone: 1 }] } })
    expect(await matchFlow(root, f, catalog, runner)).toMatchObject({ kind: 'plan', calls: 0 })
    expect(runner).toHaveBeenCalledTimes(1)
  })
  it('gives a catalog-only refusal one re-ask, then reports mapping gaps, not absent behavior', async () => {
    const runner = vi.fn(async () => ({ unrealizable: 'No pagination interface' }))
    expect(await matchFlow(repo(), flow(), catalog, runner)).toMatchObject({ kind: 'gap', calls: 2,
      gaps: [{ milestone: 1, kind: 'mapping' }, { milestone: 2, kind: 'mapping' }] })
  })
  it('retains a partial plan after one bounded correction for an omitted milestone', async () => {
    const runner = vi.fn(async () => ({ plan: [{ interfaceId: control.id, milestone: 1 }] }))
    expect(await matchFlow(repo(), flow(), catalog, runner)).toMatchObject({ kind: 'plan', calls: 2,
      gaps: [{ milestone: 2, kind: 'mapping' }] })
  })
  it('does not let the matcher replace implementation inspection with a UI assertion', async () => {
    const f = flow({ verification: { method: 'implementation', observable: 'Inspect arithmetic to exclude floating-point multiplication' } })
    const runner = vi.fn(async (ctx) => {
      expect(ctx.milestones.map((m) => m.order)).toEqual([1])
      return { plan: [{ interfaceId: control.id, milestone: 1 }] }
    })
    expect(await matchFlow(repo(), f, catalog, runner)).toMatchObject({ kind: 'plan', calls: 1,
      gaps: [{ milestone: 2, kind: 'capability', reason: expect.stringContaining('implementation') }] })
  })
  it.each([
    { plan: [{ interfaceId: 'web/invented', milestone: 1 }], gaps: [{ milestone: 2, kind: 'mapping', reason: 'missing' }] },
    { plan: [{ interfaceId: control.id, milestone: 1 }], gaps: [{ milestone: 1, kind: 'mapping', reason: 'contradiction' }, { milestone: 2, kind: 'mapping', reason: 'missing' }] },
  ])('refuses invented or conflicting references', async (reply) => {
    expect(await matchFlow(repo(), flow(), catalog, async () => reply)).toMatchObject({ kind: 'error', calls: 2 })
  })
  it('explains contradictory gaps on the corrective call so a valid plan can be recovered', async () => {
    const runner = vi.fn().mockResolvedValueOnce({
      plan: [{ interfaceId: control.id, milestone: 1 }],
      gaps: [{ milestone: 1, kind: 'mapping', reason: 'conflict' }, { milestone: 2, kind: 'mapping', reason: 'missing' }],
    }).mockImplementationOnce(async (ctx) => {
      expect(ctx.issues.gapErrors).toContain('milestone 1 appears in both plan and gaps; use one disposition')
      expect(ctx.issues.uncoveredMilestones).toEqual([])
      expect(buildMatchUserPrompt(ctx)).toContain('milestone 1 appears in both plan and gaps')
      return { plan: [1, 2].map((milestone) => ({ interfaceId: control.id, milestone })) }
    })
    expect(await matchFlow(repo(), flow(), catalog, runner)).toMatchObject({ kind: 'plan', calls: 2, gaps: [] })
  })
  it('persists the offending references when correction fails', async () => {
    const result = await matchFlow(repo(), flow(), catalog, async () => ({
      plan: [{ interfaceId: 'web/invented', milestone: 1 }],
      gaps: [{ milestone: 9, kind: 'mapping', reason: 'missing' }, { milestone: 9, kind: 'mapping', reason: 'duplicate' }],
    }))
    expect(result).toMatchObject({ kind: 'error', reason: expect.stringContaining('unknown interface ids: web/invented') })
    expect(result).toMatchObject({ reason: expect.stringContaining('gap names unknown milestone 9') })
    expect(result).toMatchObject({ reason: expect.stringContaining('milestone 9 has duplicate gaps') })
  })
  it('advertises a full-page refresh as native browser navigation, not a missing app control', () => {
    expect(MATCH_SYSTEM_PROMPT).toContain('SAME detail')
    expect(MATCH_SYSTEM_PROMPT).toContain('Do not require a Refresh button')
  })
  it('invalidates matching when control preconditions change', () => {
    expect(buildSurfaceCatalogs([{ ...control, startingState: 'second-page' }]).get('web')!.fingerprint).not.toBe(catalog.fingerprint)
  })

  it('plans zero model calls when all obligations require unavailable inspection', async () => {
    const root = repo()
    const f = flow()
    for (const m of f.milestones) m.verification = { method: 'implementation', observable: 'Inspect transaction implementation' }
    f.fingerprint = flowFingerprint(f.milestones)
    const runner = vi.fn()
    expect(await planFlowMatching(root, [f], [catalog])).toMatchObject({ calls: 0 })
    expect(await matchFlow(root, f, catalog, runner)).toMatchObject({ kind: 'gap', calls: 0 })
    expect(runner).not.toHaveBeenCalled()
  })
})

function caseFlow(): GuardFlow {
  const f = flow()
  f.milestones = [{ ...f.milestones[0], verification: { method: 'behavior', scope: 'web', observable: 'Inspect table and navigation', cases: [
    { id: 'date-order', claim: 'Rows descend by expense date', method: 'behavior', requires: ['browser'], conditions: [] },
    { id: 'tie-order', claim: 'Equal dates descend by ID', method: 'behavior', requires: ['browser'], conditions: [] },
    { id: 'description-link', claim: 'Description opens details', method: 'behavior', requires: ['browser'], conditions: [] },
  ] } }]
  f.fingerprint = flowFingerprint(f.milestones)
  return f
}

describe('case-level realization assignments', () => {
  it('retains both sorts while the description action is missing, including cache replay', async () => {
    const root = repo(); const f = caseFlow()
    const runner = vi.fn(async () => ({ plan: [{ interfaceId: control.id, milestone: 1, checks: ['date-order', 'tie-order'] }],
      gaps: [{ milestone: 1, checks: ['description-link'], kind: 'mapping', reason: 'Description navigation action missing; reconcile spec.md#expenses' }] }))
    expect(await matchFlow(root, f, catalog, runner)).toMatchObject({ kind: 'plan', calls: 1,
      plan: { steps: [{ checks: ['date-order', 'tie-order'] }] }, gaps: [{ checks: ['description-link'] }] })
    expect(await readCachedMatch(root, f, catalog)).toMatchObject({ plan: { steps: [{ checks: ['date-order', 'tie-order'] }] } })
    expect(await matchFlow(root, f, catalog, runner)).toMatchObject({ kind: 'plan', calls: 0, gaps: [{ checks: ['description-link'] }] })
    expect(runner).toHaveBeenCalledTimes(1)
  })
  it('retains repeated grounded actions serving the same check in their original order', async () => {
    const result = await matchFlow(repo(), caseFlow(), catalog, async () => ({ plan: [
      { interfaceId: control.id, milestone: 1, checks: ['date-order'], note: 'arrange' },
      { interfaceId: control.id, milestone: 1, checks: ['date-order', 'tie-order', 'description-link'], note: 'observe' },
    ] }))
    expect(result).toMatchObject({ kind: 'plan', plan: { steps: [{ note: 'arrange' }, { note: 'observe' }] }, gaps: [] })
  })
  it.each([
    { checks: ['date-order', 'unknown'], gapChecks: ['tie-order', 'description-link'], issue: 'unknown check unknown' },
    { checks: ['date-order', 'tie-order'], gapChecks: ['date-order', 'description-link'], issue: 'check date-order appears in both plan and gaps' },
    { checks: ['date-order', 'date-order'], gapChecks: ['tie-order', 'description-link'], issue: 'repeats a check' },
  ])('rejects invalid case references: $issue', async ({ checks, gapChecks, issue }) => {
    const result = await matchFlow(repo(), caseFlow(), catalog, async () => ({
      plan: [{ interfaceId: control.id, milestone: 1, checks }], gaps: [{ milestone: 1, checks: gapChecks, kind: 'mapping', reason: 'missing' }],
    }))
    expect(result).toMatchObject({ kind: 'error', calls: 2, reason: expect.stringContaining(issue) })
  })
  it('rejects duplicate gap dispositions for the same case', async () => {
    expect(await matchFlow(repo(), caseFlow(), catalog, async () => ({
      plan: [{ interfaceId: control.id, milestone: 1, checks: ['date-order', 'tie-order'] }],
      gaps: [1, 2].map(() => ({ milestone: 1, checks: ['description-link'], kind: 'mapping', reason: 'missing' })),
    }))).toMatchObject({ kind: 'plan', plan: { steps: [{ checks: ['date-order', 'tie-order'] }] }, gaps: [{ checks: ['description-link'], reason: expect.stringContaining('check description-link has duplicate gaps') }] })
  })
  it('gives omitted checks one correction, then preserves exact missing cases with source references', async () => {
    const runner = vi.fn(async () => ({ plan: [{ interfaceId: control.id, milestone: 1, checks: ['date-order'] }] }))
    expect(await matchFlow(repo(), caseFlow(), catalog, runner)).toMatchObject({ kind: 'plan', calls: 2,
      gaps: [{ milestone: 1, checks: ['tie-order', 'description-link'], reason: expect.stringContaining('spec.md#expenses') }] })
    expect(runner.mock.calls[1][0].issues.gapErrors).toContain('milestone 1 has unaccounted checks: tie-order, description-link')
  })
  it('filters unavailable observations per case without removing a supported sibling', async () => {
    const f = caseFlow()
    f.milestones[0].verification!.cases![2].requires = ['request-control']
    const runner = vi.fn(async (ctx) => {
      expect(ctx.milestones[0].verification.cases.map((c: { id: string }) => c.id)).toEqual(['date-order', 'tie-order'])
      return { plan: [{ interfaceId: control.id, milestone: 1, checks: ['date-order', 'tie-order'] }] }
    })
    expect(await matchFlow(repo(), f, catalog, runner)).toMatchObject({ kind: 'plan', calls: 1,
      gaps: [{ checks: ['description-link'], kind: 'capability', reason: expect.stringContaining('request-control') }] })
  })
  it('misses an old explicit-case cache row instead of broadening its assignment', async () => {
    const { setCacheEntry } = await import('@truecourse/llm')
    const { matchCacheKey } = await import('../../packages/guard-generator/src/match.js')
    const root = repo(); const f = caseFlow()
    await setCacheEntry(root, 'guard/match', matchCacheKey(f, catalog), { plan: [{ interfaceId: control.id, milestone: 1 }] })
    expect(await readCachedMatch(root, f, catalog)).toBeNull()
    const runner = vi.fn(async () => ({ plan: [{ interfaceId: control.id, milestone: 1, checks: ['date-order', 'tie-order', 'description-link'] }] }))
    expect(await matchFlow(root, f, catalog, runner)).toMatchObject({ kind: 'plan', calls: 1 })
  })
})

it('uses case assignments and preparation filtering consistently for runtime and estimates', async () => {
  const { realizationAssignmentFingerprint, partitionPlanPreparations } = await import('../../packages/guard-generator/src/match.js')
  const f = caseFlow()
  f.milestones[0].verification!.cases![0].preparation = 'controlled'
  // Legacy explicit cases already carried fresh-state before preparations existed.
  f.milestones[0].verification!.cases![1].conditions = ['fresh-state']
  const result = await matchFlow(repo(), f, catalog, async () => ({ plan: [{ interfaceId: control.id, milestone: 1, checks: ['date-order', 'tie-order', 'description-link'] }] }))
  expect(result.kind).toBe('plan')
  if (result.kind !== 'plan') return
  const none = partitionPlanPreparations(f, result.plan, [])
  expect(none.plan?.steps[0].checks).toEqual(['description-link'])
  expect(none.missing).toEqual([{ milestone: 1, caseId: 'date-order', requirement: 'controlled' }, { milestone: 1, caseId: 'tie-order', requirement: 'empty' }])
  const seeded = partitionPlanPreparations(f, result.plan, [{ baseline: 'seeded' }])
  expect(seeded.plan?.steps[0].checks).toEqual(['date-order', 'description-link'])
  const empty = partitionPlanPreparations(f, result.plan, [{ baseline: 'empty' }])
  expect(empty.plan).toEqual(result.plan)
  expect(empty.missing).toEqual([])
  expect(realizationAssignmentFingerprint(none.plan!)).not.toBe(realizationAssignmentFingerprint(result.plan))
  const reorderedChecks = { ...result.plan, steps: result.plan.steps.map(s => ({ ...s, checks: [...s.checks!].reverse() })) }
  expect(realizationAssignmentFingerprint(reorderedChecks)).toBe(realizationAssignmentFingerprint(result.plan))
})

describe('bounded matcher schema correction', () => {
  it.each([
    { gaps: [{ milestone: 1, kind: 'mapping', reason: 'Missing action' }], unrealizable: 'No flow' },
    { plan: [{ interfaceId: control.id, milestone: 1 }], unrealizable: 'No flow' },
    {},
  ])('explains malformed schema fields before the single re-ask', async reply => {
    const runner = vi.fn().mockResolvedValueOnce(reply).mockImplementationOnce(async ctx => {
      expect(ctx.correction.invalidOutput).toContain('mutually exclusive')
      expect(ctx.correction.invalidOutput).toContain('plan')
      return { plan: [1, 2].map(milestone => ({ milestone, interfaceId: control.id })) }
    })
    expect(await matchFlow(repo(), flow(), catalog, runner)).toMatchObject({ kind: 'plan', calls: 2 })
    expect(runner).toHaveBeenCalledTimes(2)
  })
  it('retains a validated partial plan when correction is malformed', async () => {
    const runner = vi.fn().mockResolvedValueOnce({ plan: [{ milestone: 1, interfaceId: control.id }] }).mockResolvedValueOnce({ gaps: [{ milestone: 2, kind: 'mapping', reason: 'Missing' }], unrealizable: 'bad' })
    const result = await matchFlow(repo(), flow(), catalog, runner)
    expect(result).toMatchObject({ kind: 'plan', calls: 2, plan: { steps: [{ milestone: 1 }] } })
  })
  it('never sends a cross-timezone-only case to the matcher', async () => {
    const f = flow(); f.milestones = [{ ...f.milestones[0], verification: { scope: 'web', method: 'behavior', observable: 'Date invariant across browser timezones', cases: [{ id: 'zones', claim: 'Invariant', method: 'behavior', requires: ['browser', 'browser-timezone-control'], conditions: [] }] } }]
    const runner = vi.fn()
    expect(await matchFlow(repo(), f, catalog, runner)).toMatchObject({ kind: 'gap', calls: 0, gaps: [{ kind: 'capability' }] })
    expect(runner).not.toHaveBeenCalled()
  })
})


it('retains only independent valid cases when an unknown action survives a failed correction', async () => {
  const runner = vi.fn().mockResolvedValueOnce({ plan: [
    { interfaceId: control.id, milestone: 1, checks: ['date-order'] },
    { interfaceId: 'web/unknown', milestone: 1, checks: ['tie-order'] },
    { interfaceId: control.id, milestone: 1, checks: ['tie-order'] },
  ] }).mockResolvedValueOnce({})
  const result = await matchFlow(repo(), caseFlow(), catalog, runner)
  expect(result).toMatchObject({ kind: 'plan', calls: 2,
    plan: { steps: [{ checks: ['date-order'] }] },
    gaps: [{ checks: ['tie-order', 'description-link'], reason: expect.stringContaining('Matcher correction failed') }] })
  if (result.kind === 'plan') expect(result.plan.steps).toHaveLength(1)
})

it('never salvages a conflicted case alongside an independent valid case', async () => {
  const runner = vi.fn().mockResolvedValueOnce({ plan: [
    { interfaceId: control.id, milestone: 1, checks: ['date-order'] },
    { interfaceId: control.id, milestone: 1, checks: ['tie-order'] },
  ], gaps: [{ milestone: 1, checks: ['tie-order'], kind: 'mapping', reason: 'Conflicting assignment' }] })
    .mockResolvedValueOnce({})
  const result = await matchFlow(repo(), caseFlow(), catalog, runner)
  expect(result).toMatchObject({ kind: 'plan', calls: 2,
    plan: { steps: [{ checks: ['date-order'] }] }, gaps: [{ checks: ['tie-order', 'description-link'] }] })
  if (result.kind === 'plan') expect(result.plan.steps).toHaveLength(1)
})


it('excludes every case coupled to an unsafe shared setup action', async () => {
  const runner = vi.fn().mockResolvedValueOnce({ plan: [
    { interfaceId: control.id, milestone: 1, checks: ['date-order', 'tie-order'], note: 'shared setup' },
    { interfaceId: control.id, milestone: 1, checks: ['date-order'], note: 'dependent observation' },
    { interfaceId: control.id, milestone: 1, checks: ['description-link'], note: 'independent' },
  ], gaps: [{ milestone: 1, checks: ['tie-order'], kind: 'mapping', reason: 'Conflicting assignment' }] })
    .mockResolvedValueOnce({})
  const result = await matchFlow(repo(), caseFlow(), catalog, runner)
  expect(result).toMatchObject({ kind: 'plan', calls: 2,
    plan: { steps: [{ checks: ['description-link'], note: 'independent' }] },
    gaps: [{ checks: ['date-order', 'tie-order'] }] })
  if (result.kind === 'plan') expect(result.plan.steps).toHaveLength(1)
})


it('retains independent work when the corrective matcher call throws', async () => {
  const runner = vi.fn().mockResolvedValueOnce({ plan: [{ milestone: 1, interfaceId: control.id }] })
    .mockRejectedValueOnce(new Error('transport unavailable'))
  expect(await matchFlow(repo(), flow(), catalog, runner)).toMatchObject({ kind: 'plan', calls: 2,
    plan: { steps: [{ milestone: 1 }] }, gaps: [{ reason: expect.stringContaining('transport unavailable') }] })
})
