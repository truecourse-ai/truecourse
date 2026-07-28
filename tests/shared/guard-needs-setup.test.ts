import { describe, it, expect } from 'vitest'
import {
  GUARD_COVERAGE_STATUS_PRECEDENCE,
  GuardNeedsSetupSchema,
  GuardSectionCoverageStatusSchema,
  composeBlockedOnReason,
  deriveNeedsSetup,
  needsSetupIsDone,
  needsSetupServices,
  worstCoverageStatus,
  type GuardExternalSetupIndex,
} from '../../packages/shared/src/index'

const reason = (caps: string[]) => composeBlockedOnReason(caps, 'the forecast comes from upstream')

const KNOWN: GuardExternalSetupIndex = { 'open-meteo': 'unprovided', stripe: 'provided' }

describe('deriveNeedsSetup — the ONE rule that promotes a blocked-on gap (item 65)', () => {
  it('a KNOWN, unprovided service is needs-setup', () => {
    expect(deriveNeedsSetup(reason(['open-meteo']), KNOWN)).toEqual({
      services: ['open-meteo'],
      provided: [],
    })
  })

  it('an INCOMPLETE service is needs-setup too — half-configured is not provided', () => {
    expect(deriveNeedsSetup(reason(['acme']), { acme: 'incomplete' })).toEqual({
      services: ['acme'],
      provided: [],
    })
  })

  it('a PROVIDED service is the "setup done" sub-state — the gap is the last generate’s stale answer', () => {
    const derived = deriveNeedsSetup(reason(['stripe']), KNOWN)
    expect(derived).toEqual({ services: [], provided: ['stripe'] })
    expect(needsSetupIsDone(derived!)).toBe(true)
    expect(needsSetupServices(derived!)).toEqual(['stripe'])
  })

  it('a mixed gap is NOT done — something is still missing', () => {
    const derived = deriveNeedsSetup(reason(['open-meteo', 'stripe']), KNOWN)!
    expect(derived).toEqual({ services: ['open-meteo'], provided: ['stripe'] })
    expect(needsSetupIsDone(derived)).toBe(false)
    // The row is ABOUT the outstanding one — the provided sibling needs nothing.
    expect(needsSetupServices(derived)).toEqual(['open-meteo'])
  })

  it('a GENERIC noun stays plain blocked-on — there is nothing to provide yet', () => {
    expect(deriveNeedsSetup(reason(['external-service']), KNOWN)).toBeNull()
    expect(deriveNeedsSetup(reason(['third-party', 'network']), KNOWN)).toBeNull()
  })

  it('a service NOTHING knows about stays plain blocked-on', () => {
    expect(deriveNeedsSetup(reason(['sendgrid']), KNOWN)).toBeNull()
  })

  it('no externals data at all stays plain blocked-on — never a fabricated CTA', () => {
    expect(deriveNeedsSetup(reason(['open-meteo']), null)).toBeNull()
    expect(deriveNeedsSetup(reason(['open-meteo']), undefined)).toBeNull()
    expect(deriveNeedsSetup(reason(['open-meteo']), {})).toBeNull()
  })

  it('matches the noun case-insensitively and dedupes repeats', () => {
    expect(deriveNeedsSetup(reason(['Open-Meteo', 'open-meteo']), KNOWN)).toEqual({
      services: ['open-meteo'],
      provided: [],
    })
  })

  it('a reason that is not a blocked-on reason names nothing', () => {
    expect(deriveNeedsSetup('the board is browser-only', KNOWN)).toBeNull()
  })

  it('the payload is strict — a needs-setup carries exactly two service lists', () => {
    expect(GuardNeedsSetupSchema.safeParse({ services: [], provided: ['stripe'] }).success).toBe(true)
    expect(
      GuardNeedsSetupSchema.safeParse({ services: [], provided: [], extra: 1 }).success,
    ).toBe(false)
  })
})

describe('needs-setup RANKING — the gap tier, most actionable first', () => {
  const rank = (s: string) => GUARD_COVERAGE_STATUS_PRECEDENCE.indexOf(s as never)

  it('is a ranked coverage status (the exhaustiveness backstop compiles)', () => {
    expect(rank('needs-setup')).toBeGreaterThanOrEqual(0)
    expect(GuardSectionCoverageStatusSchema.safeParse('needs-setup').success).toBe(true)
  })

  it('outranks every other gap — it is the one a user can clear today', () => {
    for (const gap of ['blocked-on', 'unrealizable', 'no-journey', 'untestable', 'no-claim', 'dismissed', 'unguarded']) {
      expect(rank('needs-setup'), gap).toBeLessThan(rank(gap))
    }
  })

  it('never outranks a RUN — a section that ran paints its run', () => {
    for (const outcome of ['fail', 'error', 'stale', 'orphaned', 'pass', 'guarded']) {
      expect(rank(outcome), outcome).toBeLessThan(rank('needs-setup'))
    }
  })

  it('wins the rollup over a blocked sibling, and loses it to a failure', () => {
    expect(worstCoverageStatus(['blocked-on', 'needs-setup', 'untestable'])).toBe('needs-setup')
    expect(worstCoverageStatus(['needs-setup', 'fail'])).toBe('fail')
    expect(worstCoverageStatus(['needs-setup', 'pass'])).toBe('pass')
  })
})
