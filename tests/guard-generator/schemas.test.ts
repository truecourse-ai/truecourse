import { describe, it, expect } from 'vitest'
import {
  RecipeProposalSchema,
  ExtractedClaimSchema,
  DocExtractionSchema,
  ExampleBlockSchema,
} from '@truecourse/guard-generator'

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

describe('ExtractedClaimSchema — example flavor', () => {
  const NORMAL = { claim: 'x', driver: 'cli', sectionAnchor: 'a', reason: 'exit 0' }
  const BLOCK = 'SELECT\n\ta.b\nFROM a JOIN b USING (id)\n'

  it('accepts an example claim carrying flavor + the verbatim block payload', () => {
    const parsed = ExtractedClaimSchema.safeParse({
      ...NORMAL,
      flavor: 'example',
      example: { block: BLOCK, outcome: 'ST07 flags this query' },
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.flavor).toBe('example')
      // Byte-faithful — tabs/newlines survive parsing.
      expect(parsed.data.example?.block).toBe(BLOCK)
      expect(parsed.data.example?.outcome).toBe('ST07 flags this query')
    }
  })

  it('accepts a normal claim with no flavor/example (an old cache parses)', () => {
    const parsed = ExtractedClaimSchema.safeParse(NORMAL)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.flavor).toBeUndefined()
      expect(parsed.data.example).toBeUndefined()
    }
  })

  it('rejects an example payload with an empty block or outcome', () => {
    expect(ExampleBlockSchema.safeParse({ block: '', outcome: 'x' }).success).toBe(false)
    expect(ExampleBlockSchema.safeParse({ block: 'x', outcome: '' }).success).toBe(false)
  })

  it('DocExtraction round-trips a mix of example and normal claims', () => {
    const parsed = DocExtractionSchema.safeParse({
      claims: [NORMAL, { ...NORMAL, flavor: 'example', example: { block: BLOCK, outcome: 'passes' } }],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.claims).toHaveLength(2)
      expect(parsed.data.claims[0].flavor).toBeUndefined()
      expect(parsed.data.claims[1].example?.block).toBe(BLOCK)
    }
  })
})
