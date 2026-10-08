import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CreditsExhaustedError, flowFingerprint, isCreditsExhausted, type GuardFlow, type GuardFlowMilestone, type Interface } from '@truecourse/shared'
import { buildSurfaceCatalogs, matchFlow, planFlowMatching, readCachedMatch } from '../../packages/guard-generator/src/match.js'
import { MATCH_SYSTEM_PROMPT, buildMatchTaskPrompt } from '../../packages/guard-generator/src/prompts.js'
import { makeTempRepo, rmrf } from './helpers.js'
import { installMemoryKvCache, resetKvCacheStore } from '../helpers/memory-kv-cache.js'

const repos: string[] = []
beforeEach(() => { installMemoryKvCache() })
afterEach(() => { resetKvCacheStore(); while (repos.length) rmrf(repos.pop()!) })
function repo() { const r = makeTempRepo(); repos.push(r); return r }
const control: Interface = { id: 'web/cancel-add', title: 'Cancel adding', type: 'web', purpose: 'control',
  entry: { method: 'GET', path: '/' }, at: 'add-dialog', to: 'root',
  steps: [{ kind: 'activate', target: { role: 'button', name: 'Cancel' }, within: { role: 'dialog', name: 'Add expense', exact: true } }],
  fingerprint: 'sha256:cancel' }
const catalog = buildSurfaceCatalogs([control]).get('web')!
function flow(): GuardFlow {
  const milestones: GuardFlowMilestone[] = [1, 2].map((order) => ({ order, doc: 'spec.md', claimId: `claim::spec.md::o${order}`,
    claimTitle: `Obligation ${order}`, sentences: ['expenses'] }))
  return { id: 'expenses', title: 'Expenses', goal: 'Manage expenses', fingerprint: flowFingerprint(milestones),
    milestones, bindings: [{ doc: 'spec.md', sentences: ['expenses'] }], composedOf: [], synthesisInputsHash: 'inputs' }
}

describe('matching incomplete catalogs', () => {
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
  it('serves a verdict across a reworded context, says so once, and re-matches a moved surface', async () => {
    const root = repo(); const f = flow()
    const verdict = { plan: [1, 2].map((milestone) => ({ interfaceId: control.id, milestone })) }
    const runner = vi.fn(async () => verdict)
    expect((await matchFlow(root, f, catalog, runner)) as { contextMoved?: unknown }).not.toHaveProperty('contextMoved')

    // The same interface, its authored context reworded: the catalog fingerprint
    // moves, the surface's identity does not, so the stored verdict stands free.
    const reworded = buildSurfaceCatalogs([{ ...control, endState: 'no dialog open' }]).get('web')!
    expect(reworded.fingerprint).not.toBe(catalog.fingerprint)
    expect(reworded.identity).toBe(catalog.identity)
    expect(await matchFlow(root, f, reworded, runner)).toMatchObject({ kind: 'plan', calls: 0, contextMoved: true })
    // Counted once per move: the marker now names the context it was served under.
    expect(await matchFlow(root, f, reworded, runner)).not.toHaveProperty('contextMoved')

    // A structural change — and a new interface id — are real misses.
    const moved = buildSurfaceCatalogs([{ ...control, fingerprint: 'sha256:moved' }]).get('web')!
    expect(await matchFlow(root, f, moved, runner)).toMatchObject({ calls: 1 })
    const grown = buildSurfaceCatalogs([control, { ...control, id: 'web/confirm-add' }]).get('web')!
    expect(grown.identity).not.toBe(catalog.identity)
    expect(await matchFlow(root, f, grown, runner)).toMatchObject({ calls: 1 })
    expect(runner).toHaveBeenCalledTimes(3)
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
      expect(buildMatchTaskPrompt(ctx)).toContain('milestone 1 appears in both plan and gaps')
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
  it('lets an empty balance through instead of settling the pair as a failed match', async () => {
    const runner = vi.fn(async () => { throw new CreditsExhaustedError('org_test', 0) })
    await expect(matchFlow(repo(), flow(), catalog, runner)).rejects.toSatisfy(isCreditsExhausted)
    expect(runner).toHaveBeenCalledTimes(1)
  })
  it('does not settle a retained partial plan when the correction was refused on credits', async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce({ plan: [{ interfaceId: control.id, milestone: 1 }] })
      .mockRejectedValueOnce(new CreditsExhaustedError('org_test', 0))
    await expect(matchFlow(repo(), flow(), catalog, runner)).rejects.toSatisfy(isCreditsExhausted)
    expect(runner).toHaveBeenCalledTimes(2)
  })
  it('advertises a full-page refresh as native browser navigation, not a missing app control', () => {
    expect(MATCH_SYSTEM_PROMPT).toContain('SAME detail')
    expect(MATCH_SYSTEM_PROMPT).toContain('Do not require a Refresh button')
  })
  it('reads a changed control precondition as context, not as a moved surface', () => {
    const repreconditioned = buildSurfaceCatalogs([{ ...control, startingState: 'second-page' }]).get('web')!
    expect(repreconditioned.fingerprint).not.toBe(catalog.fingerprint)
    expect(repreconditioned.identity).toBe(catalog.identity)
  })

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
})


it('retains independent work when the corrective matcher call throws', async () => {
  const runner = vi.fn().mockResolvedValueOnce({ plan: [{ milestone: 1, interfaceId: control.id }] })
    .mockRejectedValueOnce(new Error('transport unavailable'))
  expect(await matchFlow(repo(), flow(), catalog, runner)).toMatchObject({ kind: 'plan', calls: 2,
    plan: { steps: [{ milestone: 1 }] }, gaps: [{ reason: expect.stringContaining('transport unavailable') }] })
})
