import { describe, expect, it } from 'vitest'
import { FidelityVerdictSchema } from '../../packages/core/src/services/guard-generate/fidelity'

describe('the fidelity verdict schema', () => {
  it('takes a faithful verdict with the confidence its JSON schema offers, and refuses a mismatch on it', () => {
    // The outcome's JSON schema lists `confidence` on every verdict and cannot
    // pair it with `flagged` alone, so a model that fills it in on a faithful
    // verdict is following the schema it was handed.
    expect(FidelityVerdictSchema.safeParse({ verdict: 'faithful', confidence: 'high' }).success).toBe(true)
    expect(FidelityVerdictSchema.safeParse({ verdict: 'faithful' }).success).toBe(true)
    const contradiction = FidelityVerdictSchema.safeParse({ verdict: 'faithful', mismatch: 'no assertion checks the output' })
    expect(contradiction.success).toBe(false)
    // Flagged still needs both halves.
    expect(FidelityVerdictSchema.safeParse({ verdict: 'flagged', mismatch: 'x' }).success).toBe(false)
    expect(FidelityVerdictSchema.safeParse({ verdict: 'flagged', mismatch: 'x', confidence: 'low' }).success).toBe(true)
  })
})
