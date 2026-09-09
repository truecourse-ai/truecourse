import { describe, expect, it } from 'vitest'
import { GuardFlowMilestoneSchema, SessionExtractedClaimSchema, flowFingerprint, scenarioMilestoneScopeDefect, verificationCapabilityGap } from '@truecourse/shared'

const milestone = { order: 1, doc: 'spec.md', anchor: 'money', claimTitle: 'Returns integer cents', proofDrivers: ['api'] as const }
const m = GuardFlowMilestoneSchema.parse(milestone)
describe('verification obligations and scoped proof', () => {
  it('retains legacy milestones and fingerprints verification changes', () => {
    const next = { ...m, verification: { method: 'implementation' as const, observable: 'Inspect use of integer arithmetic' } }
    expect(GuardFlowMilestoneSchema.parse(next).verification).toEqual(next.verification)
    expect(flowFingerprint([next])).not.toBe(flowFingerprint([m]))
  })
  it('round-trips a separate verification requirement at extraction', () => {
    const claim = { claim: 'Amounts are stored as integers', driver: 'api', sectionAnchor: 'money', reason: 'Inspect storage', needs: [],
      verification: { method: 'datastore' as const, observable: 'Inspect stored column type and values' } }
    expect(SessionExtractedClaimSchema.parse(claim)).toEqual(claim)
    expect(verificationCapabilityGap(claim.verification, 'api')).toContain('datastore')
  })
  it('allows a nonempty subset while refusing vacuous or wrong-driver proof', () => {
    const ms = [m, { ...m, order: 2 }]
    const apiSteps = [{ request: { method: 'GET', path: '/money' }, milestone: 1, expect: { status: 200 } }]
    expect(scenarioMilestoneScopeDefect(ms, apiSteps)).toBeUndefined()
    expect(scenarioMilestoneScopeDefect(ms, [{ milestone: 1 }])).toContain('needs an assertion')
    expect(scenarioMilestoneScopeDefect(ms, [])).toContain('at least one')
    const cliSteps = [{ run: ['check'], milestone: 1, expect: { exit: 0 } }]
    expect(scenarioMilestoneScopeDefect(ms, cliSteps)).toContain('proof drivers')
  })
})

describe('case observation boundaries', () => {
  it('filters capability requirements by explicit case identity', () => {
    const verification = { method: 'behavior' as const, observable: 'Visible state and controlled failure', cases: [
      { id: 'rows', claim: 'Rows are ordered', method: 'behavior' as const, requires: ['browser' as const], conditions: [] },
      { id: 'failure', claim: 'Show forced failure', method: 'behavior' as const, requires: ['request-control' as const], conditions: [] },
    ] }
    expect(verificationCapabilityGap(verification, 'web')).toContain('request-control')
    expect(verificationCapabilityGap(verification, 'web', ['rows'])).toBeUndefined()
    expect(verificationCapabilityGap(verification, 'api', ['rows'])).toContain('browser')
  })
  it('refuses structured UI/protocol mixtures and unsupported advertised proof drivers', async () => {
    const { verificationBoundaryProblems } = await import('@truecourse/shared')
    const web = { method: 'behavior' as const, scope: 'web' as const, observable: 'After save', cases: [
      { id: 'save', claim: 'Dialog closes', method: 'behavior' as const, requires: ['browser' as const], conditions: [] },
    ] }
    expect(verificationBoundaryProblems(web, true, ['web'])).toEqual([])
    expect(verificationBoundaryProblems(web, true, ['web', 'api']).join(' ')).toContain('web proof only')
    expect(verificationBoundaryProblems({ ...web, cases: [...web.cases, { ...web.cases[0], id: 'post', requires: ['http'] }] }, true).join(' ')).toContain('Move protocol')
    expect(verificationBoundaryProblems({ ...web, scope: 'api' }, true).join(' ')).toContain('cannot prove browser')
  })
  it('preserves empty and controlled preparation as data conditions rather than datastore observation', async () => {
    const { GuardVerificationSchema, verificationBoundaryProblems } = await import('@truecourse/shared')
    const empty = GuardVerificationSchema.parse({ method: 'behavior', scope: 'web', observable: 'Empty ledger', cases: [
      { id: 'empty-total', claim: 'An empty ledger shows $0.00', method: 'behavior', requires: ['browser'], conditions: ['fresh-state'], preparation: 'empty' },
    ] })
    const controlled = GuardVerificationSchema.parse({ method: 'behavior', scope: 'web', observable: 'Known list total', cases: [
      { id: 'total', claim: 'Total equals the sum of known records', method: 'behavior', requires: ['browser'], conditions: [], preparation: 'controlled' },
    ] })
    expect(verificationBoundaryProblems(empty, true, ['web'])).toEqual([])
    expect(verificationBoundaryProblems(controlled, true, ['web'])).toEqual([])
    expect(verificationCapabilityGap(empty, 'web')).toBeUndefined()
    expect(verificationCapabilityGap(controlled, 'web')).toBeUndefined()
    expect(verificationBoundaryProblems({ ...empty, cases: [...empty.cases!, ...controlled.cases!] }, true).join(' ')).toContain('different starting')
  })
  it('round-trips precise gap identities without changing historical gaps', async () => {
    const { GuardManifestGapSchema, GuardCoverageGapSchema } = await import('@truecourse/shared')
    const legacy = { surface: 'web', kind: 'no-interface', milestones: [1], reason: 'missing navigation' }
    expect(GuardManifestGapSchema.parse(legacy)).toEqual(legacy)
    const obligations = [{ milestone: 1, caseId: 'description-link' }]
    expect(GuardManifestGapSchema.parse({ ...legacy, obligations }).obligations).toEqual(obligations)
    expect(GuardCoverageGapSchema.parse({ doc: 'spec.md', anchor: 'list', kind: 'no-interface', reason: 'missing', milestones: [1], obligations }).obligations).toEqual(obligations)
  })
})
