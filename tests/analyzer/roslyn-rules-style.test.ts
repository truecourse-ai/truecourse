import { describe, it, expect } from 'vitest'
import {
  runRoslynHost,
  resolveRoslynHostBinary,
} from '../../packages/analyzer/src/roslyn-host-client'

// These exercise the real .NET Roslyn semantic host. They run only when it's been
// built (`dotnet build -c Release tools/csharp-roslyn-host`); otherwise they skip.
const hostBuilt = resolveRoslynHostBinary() !== null

/** Run a single C# snippet through the host, scoped to one rule key. */
async function keys(text: string, ruleKey: string): Promise<string[]> {
  const violations = await runRoslynHost([{ path: 'Test.cs', text }], [ruleKey])
  return violations.map((v) => v.ruleKey)
}

describe.skipIf(!hostBuilt)('Roslyn host — style rules (semantic C#)', () => {

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
