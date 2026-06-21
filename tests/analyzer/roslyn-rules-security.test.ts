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

describe.skipIf(!hostBuilt)('Roslyn host — security rules (semantic C#)', () => {
  // ---- hardcoded-ip-address ----------------------------------------------
  describe('hardcoded-ip-address', () => {
    const K = 'security/deterministic/hardcoded-ip-address'

    it('flags a routable IPv4 literal', async () => {
      const src = `class C { string Host = "8.8.8.8"; }`
      expect(await keys(src, K)).toContain(K)
    })

    it('flags a private-range IPv4 literal', async () => {
      const src = `class C { string Host = "10.0.0.5"; }`
      expect(await keys(src, K)).toContain(K)
    })

    it('flags a routable IPv6 literal', async () => {
      const src = `class C { string Host = "2001:4860:4860::8888"; }`
      expect(await keys(src, K)).toContain(K)
    })

    it('does not flag loopback', async () => {
      const src = `class C { string Host = "127.0.0.1"; }`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag 0.0.0.0 (unspecified)', async () => {
      const src = `class C { string Host = "0.0.0.0"; }`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag the IPv6 documentation range', async () => {
      const src = `class C { string Host = "2001:db8::1"; }`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag a version-like string with three parts', async () => {
      const src = `class C { string V = "1.2.3"; }`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag a four-part version with an out-of-range octet', async () => {
      const src = `class C { string V = "1.2.3.400"; }`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag a non-address string', async () => {
      const src = `class C { string S = "hello world"; }`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag link-local 169.254.x.x', async () => {
      const src = `class C { string Host = "169.254.1.1"; }`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag a documentation IPv4 (192.0.2.0/24)', async () => {
      const src = `class C { string Host = "192.0.2.5"; }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })
})
