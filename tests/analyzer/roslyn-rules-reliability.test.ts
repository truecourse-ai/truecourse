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

describe.skipIf(!hostBuilt)('Roslyn host — reliability rules (semantic C#)', () => {
  // ---- cancellationtoken-not-forwarded -----------------------------------
  describe('cancellationtoken-not-forwarded', () => {
    const K = 'reliability/deterministic/cancellationtoken-not-forwarded'

    it('flags a call that drops an in-scope token when a token overload exists', async () => {
      const src = `
using System.Threading;
class Worker {
  public void Do() {}
  public void Do(CancellationToken ct) {}
  void Run(CancellationToken ct) { Do(); }
}`
      expect(await keys(src, K)).toContain(K)
    })

    it('does not flag when the token is forwarded', async () => {
      const src = `
using System.Threading;
class Worker {
  public void Do() {}
  public void Do(CancellationToken ct) {}
  void Run(CancellationToken ct) { Do(ct); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag when no token is in scope', async () => {
      const src = `
using System.Threading;
class Worker {
  public void Do() {}
  public void Do(CancellationToken ct) {}
  void Run() { Do(); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag when no token-accepting overload exists', async () => {
      const src = `
using System.Threading;
class Worker {
  public void Do() {}
  void Run(CancellationToken ct) { Do(); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag a call that already binds the token overload', async () => {
      const src = `
using System.Threading;
class Worker {
  public void Do(CancellationToken ct) {}
  void Run(CancellationToken ct) { Do(ct); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- class-with-idisposable-members-not-disposable ---------------------
  describe('class-with-idisposable-members-not-disposable', () => {
    const K = 'reliability/deterministic/class-with-idisposable-members-not-disposable'

    it('flags a class that constructs an IDisposable field in its initializer', async () => {
      const src = `
using System.IO;
class Owner {
  private MemoryStream _s = new MemoryStream();
}`
      expect(await keys(src, K)).toContain(K)
    })

    it('flags a class that constructs an IDisposable field in its constructor', async () => {
      const src = `
using System.IO;
class Owner {
  private MemoryStream _s;
  public Owner() { _s = new MemoryStream(); }
}`
      expect(await keys(src, K)).toContain(K)
    })

    it('does not flag when the class implements IDisposable', async () => {
      const src = `
using System;
using System.IO;
class Owner : IDisposable {
  private MemoryStream _s = new MemoryStream();
  public void Dispose() { _s.Dispose(); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag a borrowed (injected) IDisposable field', async () => {
      const src = `
using System.IO;
class Consumer {
  private Stream _s;
  public Consumer(Stream s) { _s = s; }
}`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag a non-IDisposable field', async () => {
      const src = `class C { private object _o = new object(); }`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag a static IDisposable field', async () => {
      const src = `
using System.IO;
class C { private static MemoryStream _s = new MemoryStream(); }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })
})
