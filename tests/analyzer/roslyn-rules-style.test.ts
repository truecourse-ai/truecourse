import { describe, it, expect } from 'vitest'
import { roslynHostBuilt, useRoslynHost } from './helpers'

const { keys } = useRoslynHost()

describe.skipIf(!roslynHostBuilt)('Roslyn host — style rules (semantic C#)', () => {

  // ---- partial-return-type-escape ----------------------------------------
  describe('partial-return-type-escape', () => {
    const K = 'style/deterministic/partial-return-type-escape'

    it('flags a method whose return type is the bare identifier partial', async () => {
      const src = `
class @partial {}
class C { partial M() { return null; } }`
      expect(await keys(src, K)).toContain(K)
    })

    it('does not flag when the return type is escaped as @partial', async () => {
      const src = `
class @partial {}
class C { @partial M() { return null; } }`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag an ordinary partial class declaration', async () => {
      const src = `partial class C { void M() {} }`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag an ordinary return type', async () => {
      const src = `class C { string M() { return null; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })
})
