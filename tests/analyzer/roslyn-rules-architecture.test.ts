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

describe.skipIf(!hostBuilt)('Roslyn host — architecture rules (semantic C#)', () => {
  // ---- deep-inheritance-chain --------------------------------------------
  describe('deep-inheritance-chain', () => {
    const K = 'architecture/deterministic/deep-inheritance-chain'
    const chain = `
class A {}
class B : A {}
class C : B {}
class D : C {}
class E : D {}
class F : E {}
class G : F {}`
    it('flags a class 6+ levels deep', async () => {
      // G derives A<-B<-C<-D<-E<-F<-G => depth 6 (> 5).
      expect(await keys(chain, K)).toContain(K)
    })
    it('does not flag a shallow hierarchy', async () => {
      const src = `class A {} class B : A {} class C : B {}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- deep-inheritance-tree ---------------------------------------------
  describe('deep-inheritance-tree', () => {
    const K = 'architecture/deterministic/deep-inheritance-tree'
    it('flags a deep chain of project-defined base classes', async () => {
      const src = `
class A {}
class B : A {}
class C : B {}
class D : C {}
class E : D {}
class F : E {}
class G : F {}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag deriving deeply from framework bases only', async () => {
      // EventArgs/Exception etc. live in referenced assemblies, not the source set,
      // so a single user class extending one framework type is depth 0 here.
      const src = `
using System;
class MyArgs : EventArgs {}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- class-coupled-to-too-many -----------------------------------------
  describe('class-coupled-to-too-many', () => {
    const K = 'architecture/deterministic/class-coupled-to-too-many'
    it('flags a class referencing many distinct types', async () => {
      const types = Array.from({ length: 25 }, (_, i) => `class T${i} {}`).join('\n')
      const fields = Array.from({ length: 25 }, (_, i) => `  T${i} f${i};`).join('\n')
      const src = `${types}\nclass Hub {\n${fields}\n}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a focused class', async () => {
      const src = `
class Dep {}
class Service { Dep _d; void M(Dep d) { _d = d; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- excessive-class-coupling ------------------------------------------
  describe('excessive-class-coupling', () => {
    const K = 'architecture/deterministic/excessive-class-coupling'
    it('flags a single method touching many distinct types', async () => {
      const types = Array.from({ length: 20 }, (_, i) => `class U${i} { public U${i}() {} }`).join('\n')
      const news = Array.from({ length: 20 }, (_, i) => `    var x${i} = new U${i}();`).join('\n')
      const src = `${types}\nclass Orchestrator {\n  void Do() {\n${news}\n  }\n}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a small method', async () => {
      const src = `
class Dep { public int V; }
class C { int M(Dep d) { return d.V; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- missing-public-argument-validation --------------------------------
  describe('missing-public-argument-validation', () => {
    const K = 'architecture/deterministic/missing-public-argument-validation'
    it('flags a public method dereferencing a param with no null check', async () => {
      const src = `
public class C { public int Len(string s) { return s.Length; } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag when the param is null-checked', async () => {
      const src = `
public class C {
  public int Len(string s) { if (s == null) return 0; return s.Length; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag ThrowIfNull guard', async () => {
      const src = `
using System;
public class C {
  public int Len(string s) { ArgumentNullException.ThrowIfNull(s); return s.Length; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a nullable-annotated param', async () => {
      const src = `
#nullable enable
public class C { public int Len(string? s) { return s!.Length; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a private method', async () => {
      const src = `
public class C { private int Len(string s) { return s.Length; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a value-type param', async () => {
      const src = `
public class C { public int Inc(int n) { return n + 1; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag null-conditional access', async () => {
      const src = `
public class C { public int? Len(string s) { return s?.Length; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- private-method-belongs-in-nested-class ----------------------------
  describe('private-method-belongs-in-nested-class', () => {
    const K = 'architecture/deterministic/private-method-belongs-in-nested-class'
    it('flags a private method used only by a nested type', async () => {
      const src = `
class Outer {
  private int Helper() { return 1; }
  class Inner { void Use(Outer o) { var x = o.Helper(); } }
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag when the outer type also uses it', async () => {
      const src = `
class Outer {
  private int Helper() { return 1; }
  void Caller() { var x = Helper(); }
  class Inner { void Use(Outer o) { var x = o.Helper(); } }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag when two nested types use it', async () => {
      const src = `
class Outer {
  private int Helper() { return 1; }
  class A { void U(Outer o) { var x = o.Helper(); } }
  class B { void U(Outer o) { var x = o.Helper(); } }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag an uncalled private method', async () => {
      const src = `
class Outer {
  private int Helper() { return 1; }
  class Inner {}
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- prefer-uri-over-string --------------------------------------------
  describe('prefer-uri-over-string', () => {
    const K = 'architecture/deterministic/prefer-uri-over-string'
    it('flags a public method taking a url string with no Uri overload', async () => {
      const src = `
public class Client { public void Fetch(string url) {} }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag when a System.Uri overload exists', async () => {
      const src = `
using System;
public class Client {
  public void Fetch(string url) {}
  public void Fetch(Uri url) {}
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a non-url string parameter', async () => {
      const src = `
public class Client { public void Save(string name) {} }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a private method', async () => {
      const src = `
public class Client { private void Fetch(string url) {} }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- uri-string-overload-not-delegating --------------------------------
  describe('uri-string-overload-not-delegating', () => {
    const K = 'architecture/deterministic/uri-string-overload-not-delegating'

    it('flags a string overload that parses the URL instead of delegating', async () => {
      const src = `using System;
class Client {
  public void Get(Uri url) { }
  public void Get(string url) { var host = url.Split('/')[2]; }
}`
      expect(await keys(src, K)).toContain(K)
    })

    it('does not flag when the string overload builds a Uri and forwards', async () => {
      const src = `using System;
class Client {
  public void Get(Uri url) { }
  public void Get(string url) { Get(new Uri(url)); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag a string method with no Uri overload', async () => {
      const src = `class Client { public void Get(string url) { var x = url.Length; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })
})
