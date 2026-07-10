import { describe, it, expect } from 'vitest'
import { RecipeProposalSchema } from '@truecourse/guard-generator'

describe('RecipeProposalSchema', () => {
  it('accepts an optional install command', () => {
    const parsed = RecipeProposalSchema.safeParse({
      install: 'npm ci',
      build: 'npm run build',
      entry: ['node', 'dist/cli.js'],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.install).toBe('npm ci')
  })

  it('still accepts a proposal without install (back-compat)', () => {
    const parsed = RecipeProposalSchema.safeParse({ build: 'true', entry: ['node', 'x.js'] })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.install).toBeUndefined()
  })

  it('rejects an empty install command', () => {
    const parsed = RecipeProposalSchema.safeParse({ install: '', build: 'true', entry: ['node', 'x.js'] })
    expect(parsed.success).toBe(false)
  })
})
