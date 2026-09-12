import { describe, expect, it } from 'vitest'
import type { GuardFailureObservation } from '@truecourse/shared'
import { compareFailureObservations } from '../../packages/guard-generator/src/failure-observation.js'
import { canonicalWebObservationUrl } from '../../packages/guard-runner/src/web/executor.js'

const target: GuardFailureObservation = { version: 1, kind: 'web-target', assertion: 'visible:0', page: 'guard-server://web/settings', operation: 'to see', locator: { role: 'button', name: 'Save' }, matchCount: 0, visibility: 'hidden', reason: 'absent' }

describe('supported web observation equivalence', () => {
  it('ignores JSON object key order, never semantic field changes', () => {
    expect(compareFailureObservations(target, { ...target, locator: { name: 'Save', role: 'button' } })).toBeUndefined()
    for (const change of [
      { assertion: 'visible:1' }, { page: 'guard-server://web/login' },
      { page: 'guard-server://other/settings' }, { operation: 'to click' },
      { locator: { role: 'button', name: 'save' } }, { matchCount: 1, reason: 'hidden' },
      { matchCount: 2, reason: 'ambiguous', visibility: 'visible' }, { visibility: 'unknown' },
      { locator: { role: 'button', name: 'Save', within: { role: 'dialog', name: 'Other' } } },
    ]) expect(compareFailureObservations(target, { ...target, ...change } as GuardFailureObservation)).toBeTruthy()
  })
  it('normalizes only the proven origin and preserves page identity', () => {
    const page = (port: number) => canonicalWebObservationUrl(`http://127.0.0.1:${port}/settings?team=123#tab`, `http://127.0.0.1:${port}`, 'web')
    expect(page(1234)).toBe(page(5678))
    expect(canonicalWebObservationUrl('https://external.test:1234/settings', 'http://127.0.0.1:1234', 'web')).toBe('https://external.test:1234/settings')
    expect(canonicalWebObservationUrl('http://127.0.0.1:12345/settings', 'http://127.0.0.1:1234', 'web')).toBe('http://127.0.0.1:12345/settings')
    expect(canonicalWebObservationUrl('http://127.0.0.1:1234/settings', 'http://127.0.0.1:1234')).toBe('http://127.0.0.1:1234/settings')
    expect(canonicalWebObservationUrl('http://user:password@127.0.0.1:1234/settings', 'http://127.0.0.1:1234', 'web')).toContain('user:password')
  })
  it('requires complete captured text and the same matcher, scope and operator', () => {
    const text: GuardFailureObservation = { version: 1, kind: 'web-text', assertion: 'text:0', page: target.page, matcher: { contains: 'Saved' }, operator: 'contains', observed: false, textDigest: `sha256:${'a'.repeat(64)}` }
    expect(compareFailureObservations(text, { ...text })).toBeUndefined()
    for (const change of [{ textDigest: `sha256:${'b'.repeat(64)}` }, { matcher: { contains: 'saved' } }, { operator: 'equals' }, { scope: { role: 'dialog', name: 'Save' } }]) {
      expect(compareFailureObservations(text, { ...text, ...change } as GuardFailureObservation)).toBeTruthy()
    }
  })
})
