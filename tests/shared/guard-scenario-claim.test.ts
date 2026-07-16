import { describe, it, expect } from 'vitest'
import { GuardScenarioSchema, GuardScenarioResultSchema } from '@truecourse/shared'

const SCENARIO = {
  guard: 1,
  id: 'fix.1',
  title: 'fix rewrites the file in place',
  binds: { doc: 'docs/cli.md', section: 'fix', fingerprint: 'sha256:x' },
  driver: 'cli' as const,
  steps: [{ run: ['fix', 'test.sql'], expect: { exit: 0 } }],
  normalize: [] as const,
}

describe('GuardScenarioSchema — optional claim', () => {
  it('round-trips a scenario that carries a claim', () => {
    const parsed = GuardScenarioSchema.safeParse({ ...SCENARIO, claim: 'fix rewrites a fixable file in place' })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.claim).toBe('fix rewrites a fixable file in place')
  })

  it('still loads a pre-claim scenario (back-compat)', () => {
    const parsed = GuardScenarioSchema.safeParse(SCENARIO)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.claim).toBeUndefined()
  })

  it('rejects an empty claim string', () => {
    const parsed = GuardScenarioSchema.safeParse({ ...SCENARIO, claim: '' })
    expect(parsed.success).toBe(false)
  })

  it('still rejects an unknown key (strict envelope kept)', () => {
    const parsed = GuardScenarioSchema.safeParse({ ...SCENARIO, bogus: true })
    expect(parsed.success).toBe(false)
  })
})

describe('GuardScenarioResultSchema — optional claim', () => {
  const RESULT = {
    id: 'fix.1',
    title: 'fix rewrites the file in place',
    binds: { doc: 'docs/cli.md', section: 'fix', fingerprint: 'sha256:x' },
    outcome: 'fail' as const,
    durationMs: 5,
    failure: { step: 1, expected: 'exit 0', actual: 'exit 2' },
  }

  it('carries the claim so drifts can frame doc-vs-code', () => {
    const parsed = GuardScenarioResultSchema.safeParse({ ...RESULT, claim: 'fix rewrites a fixable file in place' })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.claim).toBe('fix rewrites a fixable file in place')
  })

  it('still parses a pre-claim run snapshot', () => {
    const parsed = GuardScenarioResultSchema.safeParse(RESULT)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.claim).toBeUndefined()
  })
})
