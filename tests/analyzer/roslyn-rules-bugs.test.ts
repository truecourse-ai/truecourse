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

describe.skipIf(!hostBuilt)('Roslyn host — bug rules (semantic C#)', () => {
  // ---- array-covariance --------------------------------------------------
  describe('array-covariance', () => {
    const K = 'bugs/deterministic/array-covariance'
    it('flags a derived[] assigned to a base[] reference', async () => {
      const src = `
class Animal {}
class Dog : Animal {}
class C { void M() { Animal[] a = new Dog[3]; } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a same-type array', async () => {
      const src = `class Animal {} class C { void M() { Animal[] a = new Animal[3]; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a value-type (struct) array', async () => {
      const src = `class C { void M() { object[] a = new int[3]; } }`
      // int[] -> object[] is not a covariant store hazard the same way; int is a value type.
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- base-method-hidden ------------------------------------------------
  describe('base-method-hidden', () => {
    const K = 'bugs/deterministic/base-method-hidden'
    it('flags a derived method hiding a non-virtual base method', async () => {
      const src = `
class Base { public void Run() {} }
class Derived : Base { public void Run() {} }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag when override is used on a virtual base method', async () => {
      const src = `
class Base { public virtual void Run() {} }
class Derived : Base { public override void Run() {} }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag when new is used explicitly', async () => {
      const src = `
class Base { public void Run() {} }
class Derived : Base { public new void Run() {} }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a different signature (overload, not hiding)', async () => {
      const src = `
class Base { public void Run() {} }
class Derived : Base { public void Run(int x) {} }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- bitwise-on-non-flags-enum -----------------------------------------
  describe('bitwise-on-non-flags-enum', () => {
    const K = 'bugs/deterministic/bitwise-on-non-flags-enum'
    it('flags OR-combining a plain enum', async () => {
      const src = `
enum Color { Red, Green, Blue }
class C { Color M() { return Color.Red | Color.Green; } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a [Flags] enum', async () => {
      const src = `
using System;
[Flags] enum Perm { Read = 1, Write = 2 }
class C { Perm M() { return Perm.Read | Perm.Write; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag bitwise math on integers', async () => {
      const src = `class C { int M() { return 1 | 2; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- constructor-calls-virtual-method ----------------------------------
  describe('constructor-calls-virtual-method', () => {
    const K = 'bugs/deterministic/constructor-calls-virtual-method'
    it('flags a virtual call in the constructor', async () => {
      const src = `
class Base { public Base() { Init(); } protected virtual void Init() {} }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a non-virtual call in the constructor', async () => {
      const src = `
class Base { public Base() { Init(); } private void Init() {} }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a sealed class', async () => {
      const src = `
sealed class C { public C() { Init(); } void Init() {} }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- dispose-not-implementing-idisposable ------------------------------
  describe('dispose-not-implementing-idisposable', () => {
    const K = 'bugs/deterministic/dispose-not-implementing-idisposable'
    it('flags a public Dispose on a non-IDisposable type', async () => {
      const src = `class C { public void Dispose() {} }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag when the type implements IDisposable', async () => {
      const src = `
using System;
class C : IDisposable { public void Dispose() {} }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a private Dispose', async () => {
      const src = `class C { private void Dispose() {} }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- gethashcode-uses-mutable-field ------------------------------------
  describe('gethashcode-uses-mutable-field', () => {
    const K = 'bugs/deterministic/gethashcode-uses-mutable-field'
    it('flags GetHashCode reading a mutable field', async () => {
      const src = `
class C { private int _id; public override int GetHashCode() { return _id; } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag GetHashCode reading a readonly field', async () => {
      const src = `
class C { private readonly int _id; public override int GetHashCode() { return _id; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- getter-setter-wrong-field -----------------------------------------
  describe('getter-setter-wrong-field', () => {
    const K = 'bugs/deterministic/getter-setter-wrong-field'
    it('flags a getter/setter referencing different fields', async () => {
      const src = `
class C { private int _x; private int _y;
  public int Value { get { return _x; } set { _y = value; } } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a getter/setter referencing the same field', async () => {
      const src = `
class C { private int _x;
  public int Value { get { return _x; } set { _x = value; } } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- gettype-on-type-instance ------------------------------------------
  describe('gettype-on-type-instance', () => {
    const K = 'bugs/deterministic/gettype-on-type-instance'
    it('flags GetType() on a Type-typed value', async () => {
      const src = `
using System;
class C { void M(Type t) { var x = t.GetType(); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag GetType() on an ordinary object', async () => {
      const src = `class C { void M(object o) { var x = o.GetType(); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- hasflag-wrong-enum-type -------------------------------------------
  describe('hasflag-wrong-enum-type', () => {
    const K = 'bugs/deterministic/hasflag-wrong-enum-type'
    it('flags HasFlag with a different enum type', async () => {
      const src = `
using System;
[Flags] enum A { X = 1 }
[Flags] enum B { Y = 1 }
class C { bool M(A a) { return a.HasFlag(B.Y); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag HasFlag with the same enum type', async () => {
      const src = `
using System;
[Flags] enum A { X = 1, Y = 2 }
class C { bool M(A a) { return a.HasFlag(A.Y); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- lock-on-non-readonly-field ----------------------------------------
  describe('lock-on-non-readonly-field', () => {
    const K = 'bugs/deterministic/lock-on-non-readonly-field'
    it('flags lock on a non-readonly field', async () => {
      const src = `
class C { private object _gate = new object();
  void M() { lock (_gate) {} } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag lock on a readonly field', async () => {
      const src = `
class C { private readonly object _gate = new object();
  void M() { lock (_gate) {} } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- non-short-circuit-boolean -----------------------------------------
  describe('non-short-circuit-boolean', () => {
    const K = 'bugs/deterministic/non-short-circuit-boolean'
    it('flags & on booleans with a method-call right operand', async () => {
      const src = `
class C { bool Check() => true;
  bool M(bool a) { return a & Check(); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag && short-circuit', async () => {
      const src = `
class C { bool Check() => true;
  bool M(bool a) { return a && Check(); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag integer bit math', async () => {
      const src = `class C { int M(int a, int b) { return a & b; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- span-compared-to-null ---------------------------------------------
  describe('span-compared-to-null', () => {
    const K = 'bugs/deterministic/span-compared-to-null'
    it('flags a span compared to null', async () => {
      const src = `
using System;
class C { bool M(Span<int> s) { return s == null; } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a reference compared to null', async () => {
      const src = `class C { bool M(string s) { return s == null; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- static-field-initialization-order ---------------------------------
  describe('static-field-initialization-order', () => {
    const K = 'bugs/deterministic/static-field-initialization-order'
    it('flags a static initializer reading a later static field', async () => {
      const src = `
class C {
  static int A = B + 1;
  static int B = 2;
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a static initializer reading an earlier static field', async () => {
      const src = `
class C {
  static int B = 2;
  static int A = B + 1;
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- this-escapes-constructor ------------------------------------------
  describe('this-escapes-constructor', () => {
    const K = 'bugs/deterministic/this-escapes-constructor'
    it('flags this passed to external code in a constructor', async () => {
      const src = `
class Registry { public static void Add(object o) {} }
class C { public C() { Registry.Add(this); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag this passed to a private helper', async () => {
      const src = `
class C { public C() { Use(this); } private void Use(object o) {} }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- threadstatic-initialized-inline -----------------------------------
  describe('threadstatic-initialized-inline', () => {
    const K = 'bugs/deterministic/threadstatic-initialized-inline'
    it('flags an inline-initialized [ThreadStatic] field', async () => {
      const src = `
using System;
class C { [ThreadStatic] static int _count = 5; }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a [ThreadStatic] field without an initializer', async () => {
      const src = `
using System;
class C { [ThreadStatic] static int _count; }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a plain static field with an initializer', async () => {
      const src = `class C { static int _count = 5; }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- throwifnull-never-null-argument -----------------------------------
  describe('throwifnull-never-null-argument', () => {
    const K = 'bugs/deterministic/throwifnull-never-null-argument'
    it('flags ThrowIfNull on a new expression', async () => {
      const src = `
using System;
class C { void M() { ArgumentNullException.ThrowIfNull(new object()); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags ThrowIfNull on a nameof', async () => {
      const src = `
using System;
class C { void M(int x) { ArgumentNullException.ThrowIfNull(nameof(x)); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag ThrowIfNull on a nullable reference argument', async () => {
      const src = `
using System;
class C { void M(object o) { ArgumentNullException.ThrowIfNull(o); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })
})
