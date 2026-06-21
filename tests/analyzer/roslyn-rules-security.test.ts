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

  // ---- json-net-typenamehandling -----------------------------------------
  describe('json-net-typenamehandling', () => {
    const K = 'security/deterministic/json-net-typenamehandling'

    it('flags TypeNameHandling.All on JsonSerializerSettings', async () => {
      const src = `
using Newtonsoft.Json;
class C { void M() { var s = new JsonSerializerSettings(); s.TypeNameHandling = TypeNameHandling.All; } }`
      expect(await keys(src, K)).toContain(K)
    })

    it('flags TypeNameHandling.Objects set in an object initializer', async () => {
      const src = `
using Newtonsoft.Json;
class C { JsonSerializerSettings S = new JsonSerializerSettings { TypeNameHandling = TypeNameHandling.Objects }; }`
      expect(await keys(src, K)).toContain(K)
    })

    it('flags TypeNameHandling.Auto', async () => {
      const src = `
using Newtonsoft.Json;
class C { void M(JsonSerializerSettings s) { s.TypeNameHandling = TypeNameHandling.Auto; } }`
      expect(await keys(src, K)).toContain(K)
    })

    it('does not flag TypeNameHandling.None', async () => {
      const src = `
using Newtonsoft.Json;
class C { void M(JsonSerializerSettings s) { s.TypeNameHandling = TypeNameHandling.None; } }`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag when a SerializationBinder mitigates it', async () => {
      const src = `
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
class C {
  JsonSerializerSettings S = new JsonSerializerSettings {
    TypeNameHandling = TypeNameHandling.Objects,
    SerializationBinder = null,
  };
}`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag a same-named property on an unrelated type', async () => {
      const src = `
enum TypeNameHandling { None, All }
class Settings { public TypeNameHandling TypeNameHandling { get; set; } }
class C { void M(Settings s) { s.TypeNameHandling = TypeNameHandling.All; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- insecure-jsonserializersettings -----------------------------------
  describe('insecure-jsonserializersettings', () => {
    const K = 'security/deterministic/insecure-jsonserializersettings'

    it('flags settings with TypeNameHandling.All passed inline to DeserializeObject', async () => {
      const src = `
using Newtonsoft.Json;
class C { object M(string json) => JsonConvert.DeserializeObject<object>(json, new JsonSerializerSettings { TypeNameHandling = TypeNameHandling.All }); }`
      expect(await keys(src, K)).toContain(K)
    })

    it('flags settings built in a separate statement then passed to DeserializeObject', async () => {
      const src = `
using Newtonsoft.Json;
class C { object M(string json) {
  var settings = new JsonSerializerSettings { TypeNameHandling = TypeNameHandling.Objects };
  return JsonConvert.DeserializeObject<object>(json, settings);
} }`
      expect(await keys(src, K)).toContain(K)
    })

    it('flags settings passed to JsonSerializer.Create', async () => {
      const src = `
using Newtonsoft.Json;
class C { JsonSerializer M() => JsonSerializer.Create(new JsonSerializerSettings { TypeNameHandling = TypeNameHandling.Auto }); }`
      expect(await keys(src, K)).toContain(K)
    })

    it('does not flag settings with TypeNameHandling.None', async () => {
      const src = `
using Newtonsoft.Json;
class C { object M(string json) => JsonConvert.DeserializeObject<object>(json, new JsonSerializerSettings { TypeNameHandling = TypeNameHandling.None }); }`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag a DeserializeObject without settings', async () => {
      const src = `
using Newtonsoft.Json;
class C { object M(string json) => JsonConvert.DeserializeObject<object>(json); }`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag when a SerializationBinder mitigates inline settings', async () => {
      const src = `
using Newtonsoft.Json;
class C { object M(string json) => JsonConvert.DeserializeObject<object>(json, new JsonSerializerSettings { TypeNameHandling = TypeNameHandling.Objects, SerializationBinder = null }); }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })
})
