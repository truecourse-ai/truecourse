import { describe, it, expect } from 'vitest'
import { navigationGroundingProblem } from '../../packages/guard-generator/src/proof-grounding.js'
import { GuardWebLocatorSchema, describeWebLocator } from '@truecourse/shared'
describe('proof grounding', () => {
  it('selects unnamed roles without inventing their accessible names', () => {
    expect(describeWebLocator(GuardWebLocatorSchema.parse({ role: 'status' }))).toBe('status')
    expect(GuardWebLocatorSchema.safeParse({ role: 'status', name: '' }).success).toBe(false)
    expect(describeWebLocator({ role: 'status', name: 'Saved' })).toContain('Saved')
  })
  it('rejects invented query triggers and accepts documented or mapped query state', () => {
    expect(navigationGroundingProblem('/?page=999', ['/'], 'Next and Previous navigate.')).toContain('undocumented')
    expect(navigationGroundingProblem('/?page=999', ['/?page=1'], '')).toBeUndefined()
    expect(navigationGroundingProblem('/?page=999', ['/'], 'Open /?page=999 to test clamping.')).toBeUndefined()
  })
})
