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

  // ---- argument-exception-bad-arguments ----------------------------------
  describe('argument-exception-bad-arguments', () => {
    const K = 'bugs/deterministic/argument-exception-bad-arguments'
    it('flags ArgumentException with message/paramName swapped', async () => {
      const src = `
using System;
class C { void M(int count) { throw new ArgumentException("count", "must be positive"); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags ArgumentNullException with the param name in the message slot', async () => {
      const src = `
using System;
class C { void M(object value) { throw new ArgumentNullException("value cannot be null", "value"); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a correctly-ordered ArgumentException', async () => {
      const src = `
using System;
class C { void M(int count) { throw new ArgumentException("must be positive", "count"); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag when neither argument names a parameter', async () => {
      const src = `
using System;
class C { void M(int count) { throw new ArgumentException("bad", "worse"); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- base-equals-not-reference-equality --------------------------------
  describe('base-equals-not-reference-equality', () => {
    const K = 'bugs/deterministic/base-equals-not-reference-equality'
    it('flags base.Equals when the base overrides Equals with value semantics', async () => {
      const src = `
class Base { public override bool Equals(object o) => true; public override int GetHashCode() => 0; }
class Derived : Base { bool Same(object o) => base.Equals(o); }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag base.Equals when the base does not override Equals', async () => {
      const src = `
class Base {}
class Derived : Base { bool Same(object o) => base.Equals(o); }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- blockcopy-wrong-count ---------------------------------------------
  describe('blockcopy-wrong-count', () => {
    const K = 'bugs/deterministic/blockcopy-wrong-count'
    it('flags BlockCopy using an int[] Length as the byte count', async () => {
      const src = `
using System;
class C { void M(int[] src, int[] dst) { Buffer.BlockCopy(src, 0, dst, 0, src.Length); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag BlockCopy on a byte[]', async () => {
      const src = `
using System;
class C { void M(byte[] src, byte[] dst) { Buffer.BlockCopy(src, 0, dst, 0, src.Length); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag BlockCopy with an explicit byte count', async () => {
      const src = `
using System;
class C { void M(int[] src, int[] dst) { Buffer.BlockCopy(src, 0, dst, 0, src.Length * 4); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- delegate-subtraction ----------------------------------------------
  describe('delegate-subtraction', () => {
    const K = 'bugs/deterministic/delegate-subtraction'
    it('flags subtracting one delegate from another', async () => {
      const src = `
using System;
class C { Action M(Action a, Action b) => a - b; }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag numeric subtraction', async () => {
      const src = `class C { int M(int a, int b) => a - b; }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag -= on an event', async () => {
      const src = `
using System;
class C { event Action E; void M(Action h) { E -= h; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- enum-undefined-composite-flag -------------------------------------
  describe('enum-undefined-composite-flag', () => {
    const K = 'bugs/deterministic/enum-undefined-composite-flag'
    it('flags a composite value with a bit no member backs', async () => {
      const src = `
using System;
[Flags] enum F { A = 1, B = 2, Combo = 1 | 2 | 8 }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a composite of declared flags', async () => {
      const src = `
using System;
[Flags] enum F { A = 1, B = 2, C = 4, Combo = A | B | C }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- exception-from-unexpected-member ----------------------------------
  describe('exception-from-unexpected-member', () => {
    const K = 'bugs/deterministic/exception-from-unexpected-member'
    it('flags a throw in a finalizer', async () => {
      const src = `
using System;
class C { ~C() { throw new InvalidOperationException(); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags a throw in GetHashCode', async () => {
      const src = `
using System;
class C { public override int GetHashCode() { throw new NotSupportedException(); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a re-throw inside a catch in Dispose', async () => {
      const src = `
using System;
class C : IDisposable { public void Dispose() { try {} catch { throw; } } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a throw in an ordinary method', async () => {
      const src = `
using System;
class C { public void Work() { throw new InvalidOperationException(); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- exception-missing-standard-constructors ---------------------------
  describe('exception-missing-standard-constructors', () => {
    const K = 'bugs/deterministic/exception-missing-standard-constructors'
    it('flags an exception with only a custom constructor', async () => {
      const src = `
using System;
public class MyException : Exception { public MyException(int code) {} }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag an exception providing all three standard constructors', async () => {
      const src = `
using System;
public class MyException : Exception {
  public MyException() {}
  public MyException(string message) : base(message) {}
  public MyException(string message, Exception inner) : base(message, inner) {}
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a non-exception class', async () => {
      const src = `public class Plain { public Plain(int x) {} }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- explicit-caller-info-argument -------------------------------------
  describe('explicit-caller-info-argument', () => {
    const K = 'bugs/deterministic/explicit-caller-info-argument'
    it('flags passing a value for a [CallerMemberName] parameter', async () => {
      const src = `
using System.Runtime.CompilerServices;
class C {
  void Log(string msg, [CallerMemberName] string member = "") {}
  void M() { Log("hi", "explicitName"); }
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag when the caller-info argument is omitted', async () => {
      const src = `
using System.Runtime.CompilerServices;
class C {
  void Log(string msg, [CallerMemberName] string member = "") {}
  void M() { Log("hi"); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- finalizer-on-memorymanager ----------------------------------------
  describe('finalizer-on-memorymanager', () => {
    const K = 'bugs/deterministic/finalizer-on-memorymanager'
    it('flags a finalizer on a MemoryManager<T> subtype', async () => {
      const src = `
using System;
using System.Buffers;
class M : MemoryManager<byte> {
  ~M() {}
  public override Span<byte> GetSpan() => default;
  public override System.Buffers.MemoryHandle Pin(int i = 0) => default;
  public override void Unpin() {}
  protected override void Dispose(bool d) {}
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a finalizer on an unrelated type', async () => {
      const src = `class C { ~C() {} }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- flags-enum-non-power-of-two ---------------------------------------
  describe('flags-enum-non-power-of-two', () => {
    const K = 'bugs/deterministic/flags-enum-non-power-of-two'
    it('flags a [Flags] member with a non-power-of-two stray value', async () => {
      const src = `
using System;
[Flags] enum F { A = 1, B = 2, C = 3, D = 5 }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a clean power-of-two [Flags] enum with combos', async () => {
      const src = `
using System;
[Flags] enum F { None = 0, A = 1, B = 2, C = 4, All = A | B | C }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- iequatable-class-not-sealed ---------------------------------------
  describe('iequatable-class-not-sealed', () => {
    const K = 'bugs/deterministic/iequatable-class-not-sealed'
    it('flags an unsealed class implementing IEquatable<itself>', async () => {
      const src = `
using System;
class Money : IEquatable<Money> { public bool Equals(Money other) => true; }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a sealed class implementing IEquatable<itself>', async () => {
      const src = `
using System;
sealed class Money : IEquatable<Money> { public bool Equals(Money other) => true; }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a struct implementing IEquatable<itself>', async () => {
      const src = `
using System;
struct Money : IEquatable<Money> { public bool Equals(Money other) => true; }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- interface-method-not-callable-by-derived --------------------------
  describe('interface-method-not-callable-by-derived', () => {
    const K = 'bugs/deterministic/interface-method-not-callable-by-derived'
    it('flags an explicit interface method on an unsealed class with no re-exposed member', async () => {
      const src = `
interface I { void Do(); }
class C : I { void I.Do() {} }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag when a public method re-exposes the behaviour', async () => {
      const src = `
interface I { void Do(); }
class C : I { void I.Do() => Do(); public void Do() {} }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag an explicit implementation on a sealed class', async () => {
      const src = `
interface I { void Do(); }
sealed class C : I { void I.Do() {} }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- modulus-direct-equality -------------------------------------------
  describe('modulus-direct-equality', () => {
    const K = 'bugs/deterministic/modulus-direct-equality'
    it('flags x % 2 == 1 on a signed int', async () => {
      const src = `class C { bool Odd(int x) => x % 2 == 1; }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag x % 2 == 0', async () => {
      const src = `class C { bool Even(int x) => x % 2 == 0; }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag modulus on an unsigned type', async () => {
      const src = `class C { bool Odd(uint x) => x % 2 == 1; }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- non-flags-enum-with-flags-attribute -------------------------------
  describe('non-flags-enum-with-flags-attribute', () => {
    const K = 'bugs/deterministic/non-flags-enum-with-flags-attribute'
    it('flags a [Flags] enum using sequential values', async () => {
      const src = `
using System;
[Flags] enum Color { Red, Green, Blue, Yellow }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a proper power-of-two [Flags] enum', async () => {
      const src = `
using System;
[Flags] enum Perm { None = 0, Read = 1, Write = 2, Exec = 4 }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- optionalfield-missing-deserialization-handler ---------------------
  describe('optionalfield-missing-deserialization-handler', () => {
    const K = 'bugs/deterministic/optionalfield-missing-deserialization-handler'
    it('flags an [OptionalField] member with no deserialization handler', async () => {
      const src = `
using System.Runtime.Serialization;
[DataContract] class C { [OptionalField] int _added; }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag when an [OnDeserialized] handler is present', async () => {
      const src = `
using System.Runtime.Serialization;
class C {
  [OptionalField] int _added;
  [OnDeserialized] void OnDeser(StreamingContext ctx) { _added = 1; }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- pinvoke-out-string-parameter --------------------------------------
  describe('pinvoke-out-string-parameter', () => {
    const K = 'bugs/deterministic/pinvoke-out-string-parameter'
    it('flags [Out] on a by-value string P/Invoke parameter', async () => {
      const src = `
using System.Runtime.InteropServices;
class C { [DllImport("x")] static extern void Native([Out] string buffer); }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a by-value string parameter without [Out]', async () => {
      const src = `
using System.Runtime.InteropServices;
class C { [DllImport("x")] static extern void Native(string buffer); }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag [Out] on a StringBuilder parameter', async () => {
      const src = `
using System.Text;
using System.Runtime.InteropServices;
class C { [DllImport("x")] static extern void Native([Out] StringBuilder buffer); }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- referenceequals-on-value-type -------------------------------------
  describe('referenceequals-on-value-type', () => {
    const K = 'bugs/deterministic/referenceequals-on-value-type'
    it('flags ReferenceEquals on an int operand', async () => {
      const src = `class C { bool M(int a, int b) => object.ReferenceEquals(a, b); }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag ReferenceEquals on two reference operands', async () => {
      const src = `class C { bool M(object a, object b) => object.ReferenceEquals(a, b); }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- switch-expression-missing-cases -----------------------------------
  describe('switch-expression-missing-cases', () => {
    const K = 'bugs/deterministic/switch-expression-missing-cases'
    it('flags a switch expression that omits an enum member', async () => {
      const src = `
enum Color { Red, Green, Blue }
class C { string M(Color c) => c switch { Color.Red => "r", Color.Green => "g" }; }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag when all members are handled', async () => {
      const src = `
enum Color { Red, Green, Blue }
class C { string M(Color c) => c switch { Color.Red => "r", Color.Green => "g", Color.Blue => "b" }; }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag when a discard arm is present', async () => {
      const src = `
enum Color { Red, Green, Blue }
class C { string M(Color c) => c switch { Color.Red => "r", _ => "other" }; }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- taskcompletionsource-wrong-options --------------------------------
  describe('taskcompletionsource-wrong-options', () => {
    const K = 'bugs/deterministic/taskcompletionsource-wrong-options'
    it('flags TaskContinuationOptions passed to a TaskCompletionSource ctor', async () => {
      const src = `
using System.Threading.Tasks;
class C { void M() { var t = new TaskCompletionSource<int>(TaskContinuationOptions.LongRunning); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag the correct TaskCreationOptions', async () => {
      const src = `
using System.Threading.Tasks;
class C { void M() { var t = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- culture-unaware-string-operation ----------------------------------
  describe('culture-unaware-string-operation', () => {
    const K = 'bugs/deterministic/culture-unaware-string-operation'
    it('flags parameterless string.ToLower()', async () => {
      const src = `class C { string M(string s) => s.ToLower(); }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags string.Compare without a comparison', async () => {
      const src = `class C { int M(string a, string b) => string.Compare(a, b); }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag ToLowerInvariant', async () => {
      const src = `class C { string M(string s) => s.ToLowerInvariant(); }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag string.Compare with a StringComparison', async () => {
      const src = `
using System;
class C { int M(string a, string b) => string.Compare(a, b, StringComparison.Ordinal); }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a user method named ToLower on another type', async () => {
      const src = `class T { public string ToLower() => ""; } class C { string M(T t) => t.ToLower(); }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- missing-stringcomparison-overload ---------------------------------
  describe('missing-stringcomparison-overload', () => {
    const K = 'bugs/deterministic/missing-stringcomparison-overload'
    it('flags string.Equals without a StringComparison', async () => {
      const src = `class C { bool M(string a, string b) => a.Equals(b); }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags string.StartsWith(string) without a StringComparison', async () => {
      const src = `class C { bool M(string a) => a.StartsWith("x"); }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag when a StringComparison is supplied', async () => {
      const src = `
using System;
class C { bool M(string a, string b) => a.Equals(b, StringComparison.Ordinal); }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag StartsWith(char), which has no comparison overload', async () => {
      const src = `class C { bool M(string a) => a.StartsWith('x'); }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- missing-format-provider-overload ----------------------------------
  describe('missing-format-provider-overload', () => {
    const K = 'bugs/deterministic/missing-format-provider-overload'
    it('flags int.Parse without an IFormatProvider', async () => {
      const src = `class C { int M(string s) => int.Parse(s); }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags double.ToString() without a provider', async () => {
      const src = `class C { string M(double d) => d.ToString(); }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag int.Parse with a CultureInfo', async () => {
      const src = `
using System.Globalization;
class C { int M(string s) => int.Parse(s, CultureInfo.InvariantCulture); }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag ToString() on a reference type', async () => {
      const src = `class T {} class C { string M(T t) => t.ToString(); }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag DateTime.ToString("r") — RFC1123 is always culture-invariant', async () => {
      const src = `
using System;
class C { string M(DateTimeOffset d) => d.ToString("r"); }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag DateTime.ToString("O") — round-trip is always culture-invariant', async () => {
      const src = `
using System;
class C { string M(DateTime d) => d.ToString("O"); }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- normalize-to-lower-not-upper --------------------------------------
  describe('normalize-to-lower-not-upper', () => {
    const K = 'bugs/deterministic/normalize-to-lower-not-upper'
    it('flags ToLower used in a binary equality comparison', async () => {
      const src = `class C { bool M(string s) => s.ToLower() == "hello"; }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags ToLowerInvariant chained to .Equals()', async () => {
      const src = `class C { bool M(string s, string t) => s.ToLowerInvariant().Equals(t); }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags ToLower passed to string.Equals', async () => {
      const src = `class C { bool M(string s, string t) => string.Equals(s.ToLower(), t); }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags ToLower returned as a normalization result', async () => {
      const src = `class C { string Normalize(string s) => s.ToLower(); }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag ToLower embedded inside a string interpolation hole', async () => {
      const src = `class C { string M(string s) => $"class-{s.ToLower()}"; }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag ToUpperInvariant', async () => {
      const src = `class C { string M(string s) => s.ToUpperInvariant(); }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- switch-missing-cases ----------------------------------------------
  describe('switch-missing-cases', () => {
    const K = 'bugs/deterministic/switch-missing-cases'
    it('flags a switch statement that omits an enum member', async () => {
      const src = `
enum Color { Red, Green, Blue }
class C { void M(Color c) { switch (c) { case Color.Red: break; case Color.Green: break; } } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag when a default label is present', async () => {
      const src = `
enum Color { Red, Green, Blue }
class C { void M(Color c) { switch (c) { case Color.Red: break; default: break; } } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag when all members are handled', async () => {
      const src = `
enum Color { Red, Green, Blue }
class C { void M(Color c) { switch (c) { case Color.Red: break; case Color.Green: break; case Color.Blue: break; } } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- child-field-differs-only-by-case ----------------------------------
  describe('child-field-differs-only-by-case', () => {
    const K = 'bugs/deterministic/child-field-differs-only-by-case'
    it('flags a derived field differing only by case from a base field', async () => {
      const src = `
class Base { protected int Count; }
class Derived : Base { private int count; }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a private base field', async () => {
      const src = `
class Base { private int Count; }
class Derived : Base { private int count; }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag distinct field names', async () => {
      const src = `
class Base { protected int Total; }
class Derived : Base { private int count; }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- inherited-member-visibility-decreased -----------------------------
  describe('inherited-member-visibility-decreased', () => {
    const K = 'bugs/deterministic/inherited-member-visibility-decreased'
    it('flags a protected member hiding a public base member', async () => {
      const src = `
class Base { public void Run() {} }
class Derived : Base { protected new void Run() {} }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag when visibility is preserved', async () => {
      const src = `
class Base { public void Run() {} }
class Derived : Base { public new void Run() {} }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag an override (visibility is compiler-enforced)', async () => {
      const src = `
class Base { public virtual void Run() {} }
class Derived : Base { public override void Run() {} }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- override-changes-default-parameter --------------------------------
  describe('override-changes-default-parameter', () => {
    const K = 'bugs/deterministic/override-changes-default-parameter'
    it('flags an override that changes a default value', async () => {
      const src = `
class Base { public virtual void M(int x = 1) {} }
class Derived : Base { public override void M(int x = 2) {} }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag an override that keeps the same default', async () => {
      const src = `
class Base { public virtual void M(int x = 1) {} }
class Derived : Base { public override void M(int x = 1) {} }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- optional-arg-not-forwarded-to-base --------------------------------
  describe('optional-arg-not-forwarded-to-base', () => {
    const K = 'bugs/deterministic/optional-arg-not-forwarded-to-base'
    it('flags an override that does not forward its optional parameter', async () => {
      const src = `
class Base { public virtual void M(int x = 1) {} }
class Derived : Base { public override void M(int x = 1) { base.M(); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag when the optional parameter is forwarded', async () => {
      const src = `
class Base { public virtual void M(int x = 1) {} }
class Derived : Base { public override void M(int x = 1) { base.M(x); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- params-introduced-on-override -------------------------------------
  describe('params-introduced-on-override', () => {
    const K = 'bugs/deterministic/params-introduced-on-override'
    it('flags an override that adds params', async () => {
      const src = `
class Base { public virtual void M(int[] xs) {} }
class Derived : Base { public override void M(params int[] xs) {} }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag when both have params', async () => {
      const src = `
class Base { public virtual void M(params int[] xs) {} }
class Derived : Base { public override void M(params int[] xs) {} }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- icomparable-without-equality-operators ----------------------------
  describe('icomparable-without-equality-operators', () => {
    const K = 'bugs/deterministic/icomparable-without-equality-operators'
    it('flags an IComparable<T> type with no Equals or operators', async () => {
      const src = `
using System;
class Money : IComparable<Money> { public int CompareTo(Money other) => 0; }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a complete IComparable implementation', async () => {
      const src = `
using System;
class Money : IComparable<Money> {
  public int CompareTo(Money other) => 0;
  public override bool Equals(object o) => true;
  public override int GetHashCode() => 0;
  public static bool operator ==(Money a, Money b) => true;
  public static bool operator !=(Money a, Money b) => false;
  public static bool operator <(Money a, Money b) => false;
  public static bool operator >(Money a, Money b) => false;
  public static bool operator <=(Money a, Money b) => true;
  public static bool operator >=(Money a, Money b) => true;
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a record implementing IComparable', async () => {
      const src = `
using System;
record Money(int Cents) : IComparable<Money> { public int CompareTo(Money other) => 0; }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- partial-method-not-implemented ------------------------------------
  describe('partial-method-not-implemented', () => {
    const K = 'bugs/deterministic/partial-method-not-implemented'
    it('flags a declared partial method with no implementation', async () => {
      const src = `partial class C { partial void OnCreated(); }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag when an implementing part exists', async () => {
      const src = `partial class C { partial void OnCreated(); partial void OnCreated() {} }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- defaultparametervalue-without-optional ----------------------------
  describe('defaultparametervalue-without-optional', () => {
    const K = 'bugs/deterministic/defaultparametervalue-without-optional'
    it('flags [DefaultParameterValue] without [Optional]', async () => {
      const src = `
using System.Runtime.InteropServices;
class C { void M([DefaultParameterValue(5)] int x) {} }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag when [Optional] is also present', async () => {
      const src = `
using System.Runtime.InteropServices;
class C { void M([Optional, DefaultParameterValue(5)] int x) {} }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- defaultvalue-instead-of-defaultparametervalue ---------------------
  describe('defaultvalue-instead-of-defaultparametervalue', () => {
    const K = 'bugs/deterministic/defaultvalue-instead-of-defaultparametervalue'
    it('flags [DefaultValue] on a parameter', async () => {
      const src = `
using System.ComponentModel;
class C { void M([DefaultValue(5)] int x) {} }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a C# default value', async () => {
      const src = `class C { void M(int x = 5) {} }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- symbol-and-member-same-statement ----------------------------------
  describe('symbol-and-member-same-statement', () => {
    const K = 'bugs/deterministic/symbol-and-member-same-statement'
    it('flags x = x.Next = value', async () => {
      const src = `
class N { public N Next; public int Field; }
class C { void M(N x) { x = x.Next = null; } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag separate statements', async () => {
      const src = `
class N { public N Next; }
class C { void M(N x, N y) { x = y; x.Next = null; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- unchecked-enumerable-sum-overflow ---------------------------------
  describe('unchecked-enumerable-sum-overflow', () => {
    const K = 'bugs/deterministic/unchecked-enumerable-sum-overflow'
    it('flags Enumerable.Sum inside an unchecked block', async () => {
      const src = `
using System.Collections.Generic;
using System.Linq;
class C { int M(List<int> xs) { unchecked { return xs.Sum(); } } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag Sum outside an unchecked context', async () => {
      const src = `
using System.Collections.Generic;
using System.Linq;
class C { int M(List<int> xs) => xs.Sum(); }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- format-string-placeholder-mismatch --------------------------------
  describe('format-string-placeholder-mismatch', () => {
    const K = 'bugs/deterministic/format-string-placeholder-mismatch'
    it('flags a placeholder index with no matching argument', async () => {
      const src = `class C { string M() => string.Format("{0} {1}", "a"); }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags an unbalanced-brace format string', async () => {
      const src = `class C { string M() => string.Format("hello {0", "a"); }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a correct format string', async () => {
      const src = `class C { string M() => string.Format("{0} {1}", "a", "b"); }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag when arguments come from an array (cannot count statically)', async () => {
      const src = `class C { string M(object[] args) => string.Format("{0} {1}", args); }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- foreach-implicit-downcast -----------------------------------------
  describe('foreach-implicit-downcast', () => {
    const K = 'bugs/deterministic/foreach-implicit-downcast'
    it('flags a foreach declaring a derived element type over a base collection', async () => {
      const src = `
using System.Collections.Generic;
class Animal {} class Dog : Animal {}
class C { void M(List<Animal> animals) { foreach (Dog d in animals) {} } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a foreach with var', async () => {
      const src = `
using System.Collections.Generic;
class Animal {}
class C { void M(List<Animal> animals) { foreach (var a in animals) {} } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a foreach with the exact element type', async () => {
      const src = `
using System.Collections.Generic;
class Animal {}
class C { void M(List<Animal> animals) { foreach (Animal a in animals) {} } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- lock-on-shared-instance -------------------------------------------
  describe('lock-on-shared-instance', () => {
    const K = 'bugs/deterministic/lock-on-shared-instance'
    it('flags lock on this', async () => {
      const src = `class C { void M() { lock (this) {} } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags lock on a typeof', async () => {
      const src = `class C { void M() { lock (typeof(C)) {} } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags lock on a string literal', async () => {
      const src = `class C { void M() { lock ("gate") {} } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag lock on a private readonly object', async () => {
      const src = `
class C { private readonly object _gate = new object(); void M() { lock (_gate) {} } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- lock-on-weak-identity-object --------------------------------------
  describe('lock-on-weak-identity-object', () => {
    const K = 'bugs/deterministic/lock-on-weak-identity-object'
    it('flags lock on a string variable', async () => {
      const src = `class C { void M(string s) { lock (s) {} } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags lock on a Type', async () => {
      const src = `
using System;
class C { void M(Type t) { lock (t) {} } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag lock on a plain object', async () => {
      const src = `class C { private readonly object _gate = new object(); void M() { lock (_gate) {} } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- iserializable-incorrect -------------------------------------------
  describe('iserializable-incorrect', () => {
    const K = 'bugs/deterministic/iserializable-incorrect'
    it('flags an ISerializable type missing the members', async () => {
      const src = `
using System;
using System.Runtime.Serialization;
class C : ISerializable {
  public void GetObjectData(SerializationInfo info, StreamingContext ctx) {}
}`
      // missing the deserialization constructor
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a complete ISerializable implementation', async () => {
      const src = `
using System;
using System.Runtime.Serialization;
class C : ISerializable {
  public C() {}
  protected C(SerializationInfo info, StreamingContext ctx) {}
  public void GetObjectData(SerializationInfo info, StreamingContext ctx) {}
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- serialization-handler-wrong-signature -----------------------------
  describe('serialization-handler-wrong-signature', () => {
    const K = 'bugs/deterministic/serialization-handler-wrong-signature'
    it('flags an [OnDeserialized] handler with the wrong signature', async () => {
      const src = `
using System.Runtime.Serialization;
class C { [OnDeserialized] public void OnDeser() {} }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a correctly-shaped handler', async () => {
      const src = `
using System.Runtime.Serialization;
class C { [OnDeserialized] void OnDeser(StreamingContext ctx) {} }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- debuggerdisplay-invalid-member ------------------------------------
  describe('debuggerdisplay-invalid-member', () => {
    const K = 'bugs/deterministic/debuggerdisplay-invalid-member'
    it('flags a DebuggerDisplay referencing a nonexistent member', async () => {
      const src = `
using System.Diagnostics;
[DebuggerDisplay("{Missing}")] class C { public int Name; }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a DebuggerDisplay referencing an existing member', async () => {
      const src = `
using System.Diagnostics;
[DebuggerDisplay("{Name}")] class C { public int Name; }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a complex expression placeholder', async () => {
      const src = `
using System.Diagnostics;
[DebuggerDisplay("{Name + 1}")] class C { public int Name; }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- overlapping-default-overloads -------------------------------------
  describe('overlapping-default-overloads', () => {
    const K = 'bugs/deterministic/overlapping-default-overloads'
    it('flags overloads that overlap once defaults are filled in', async () => {
      const src = `
class C {
  public void M(int a) {}
  public void M(int a, int b = 0) {}
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag overloads with distinct required parameter types', async () => {
      const src = `
class C {
  public void M(int a) {}
  public void M(string a, int b = 0) {}
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag overloads where the extra parameter is required', async () => {
      const src = `
class C {
  public void M(int a) {}
  public void M(int a, int b) {}
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- non-static-log-template -------------------------------------------
  describe('non-static-log-template', () => {
    const K = 'bugs/deterministic/non-static-log-template'
    it('flags an interpolated message template', async () => {
      const src = `
using Microsoft.Extensions.Logging;
class C { void M(ILogger log, int userId) { log.LogInformation($"User {userId} signed in"); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags a concatenated message template', async () => {
      const src = `
using Microsoft.Extensions.Logging;
class C { void M(ILogger log, string name) { log.LogWarning("hello " + name); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags an interpolated template on the generic ILogger<T>', async () => {
      const src = `
using Microsoft.Extensions.Logging;
class C { void M(ILogger<C> log, int id) { log.LogError($"failed {id}"); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a constant template with named placeholders', async () => {
      const src = `
using Microsoft.Extensions.Logging;
class C { void M(ILogger log, int userId) { log.LogInformation("User {UserId} signed in", userId); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a literal-concatenation that folds to a constant', async () => {
      const src = `
using Microsoft.Extensions.Logging;
class C { void M(ILogger log) { log.LogInformation("part one " + "part two"); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag interpolation passed to a non-logger method named Log', async () => {
      const src = `
class Other { public void LogInformation(string m) {} }
class C { void M(Other o, int x) { o.LogInformation($"x={x}"); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- numeric-log-placeholder -------------------------------------------
  describe('numeric-log-placeholder', () => {
    const K = 'bugs/deterministic/numeric-log-placeholder'
    it('flags a numeric placeholder in a log template', async () => {
      const src = `
using Microsoft.Extensions.Logging;
class C { void M(ILogger log, int id) { log.LogInformation("user {0} signed in", id); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a named placeholder', async () => {
      const src = `
using Microsoft.Extensions.Logging;
class C { void M(ILogger log, int id) { log.LogInformation("user {UserId} signed in", id); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a numeric placeholder in a non-logger call', async () => {
      const src = `class C { string M(int id) => string.Format("user {0}", id); }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag an escaped brace pair', async () => {
      const src = `
using Microsoft.Extensions.Logging;
class C { void M(ILogger log) { log.LogInformation("literal {{0}} brace"); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- invalid-log-template-braces ---------------------------------------
  describe('invalid-log-template-braces', () => {
    const K = 'bugs/deterministic/invalid-log-template-braces'
    it('flags an unterminated placeholder brace', async () => {
      const src = `
using Microsoft.Extensions.Logging;
class C { void M(ILogger log, int id) { log.LogInformation("user {UserId signed in", id); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags a lone closing brace', async () => {
      const src = `
using Microsoft.Extensions.Logging;
class C { void M(ILogger log) { log.LogInformation("orphan } brace"); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a balanced template', async () => {
      const src = `
using Microsoft.Extensions.Logging;
class C { void M(ILogger log, int id) { log.LogInformation("user {UserId} signed in", id); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag escaped braces', async () => {
      const src = `
using Microsoft.Extensions.Logging;
class C { void M(ILogger log) { log.LogInformation("literal {{ and }} braces"); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- begininvoke-without-endinvoke -------------------------------------
  describe('begininvoke-without-endinvoke', () => {
    const K = 'bugs/deterministic/begininvoke-without-endinvoke'

    it('flags a delegate BeginInvoke with no EndInvoke', async () => {
      const src = `
using System;
class C {
  delegate int Work(int x);
  void M(Work w) { w.BeginInvoke(1, null, null); }
}`
      expect(await keys(src, K)).toContain(K)
    })

    it('does not flag when EndInvoke is present', async () => {
      const src = `
using System;
class C {
  delegate int Work(int x);
  void M(Work w) { var ar = w.BeginInvoke(1, null, null); w.EndInvoke(ar); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag Control.BeginInvoke (not a delegate receiver)', async () => {
      const src = `
using System;
class Control { public object BeginInvoke(Delegate d) => null; }
class C {
  void M(Control ctrl) { ctrl.BeginInvoke(new Action(() => {})); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- event-handler-wrong-signature -------------------------------------
  describe('event-handler-wrong-signature', () => {
    const K = 'bugs/deterministic/event-handler-wrong-signature'

    it('flags a custom delegate event without object sender', async () => {
      const src = `
using System;
class DataEventArgs : EventArgs { }
delegate void DataHandler(string source, DataEventArgs e);
class C { public event DataHandler Received; }`
      expect(await keys(src, K)).toContain(K)
    })

    it('flags a custom delegate whose second arg is not EventArgs', async () => {
      const src = `
using System;
delegate void Changed(object sender, int value);
class C { public event Changed OnChanged; }`
      expect(await keys(src, K)).toContain(K)
    })

    it('does not flag a conventional custom delegate', async () => {
      const src = `
using System;
class DataEventArgs : EventArgs { }
delegate void DataHandler(object sender, DataEventArgs e);
class C { public event DataHandler Received; }`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag EventHandler<T>', async () => {
      const src = `
using System;
class DataEventArgs : EventArgs { }
class C { public event EventHandler<DataEventArgs> Received; }`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag an Action-based event', async () => {
      const src = `
using System;
class C { public event Action<int> Ticked; }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- event-never-invoked -----------------------------------------------
  describe('event-never-invoked', () => {
    const K = 'bugs/deterministic/event-never-invoked'

    it('flags an event that is never raised', async () => {
      const src = `using System;
class C { public event EventHandler Changed; public void Touch() { } }`
      expect(await keys(src, K)).toContain(K)
    })

    it('does not flag an event raised via ?.Invoke', async () => {
      const src = `using System;
class C {
  public event EventHandler Changed;
  void Go() { Changed?.Invoke(this, EventArgs.Empty); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag a virtual event (a derived type may raise it)', async () => {
      const src = `using System;
class C { public virtual event EventHandler Changed; }`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag an interface event declaration', async () => {
      const src = `using System;
interface I { event EventHandler Changed; }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- stream-read-result-ignored ----------------------------------------
  describe('stream-read-result-ignored', () => {
    const K = 'bugs/deterministic/stream-read-result-ignored'

    it('flags a discarded Stream.Read(buffer, offset, count)', async () => {
      const src = `using System.IO;
class C { void M(Stream s, byte[] buf) { s.Read(buf, 0, buf.Length); } }`
      expect(await keys(src, K)).toContain(K)
    })

    it('does not flag when the result is captured', async () => {
      const src = `using System.IO;
class C { int M(Stream s, byte[] buf) { int n = s.Read(buf, 0, buf.Length); return n; } }`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag a non-Stream Read', async () => {
      const src = `class Reader { public int Read(byte[] b, int o, int c) => 0; }
class C { void M(Reader r, byte[] buf) { r.Read(buf, 0, buf.Length); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- initial-value-overwritten -----------------------------------------
  describe('initial-value-overwritten', () => {
    const K = 'bugs/deterministic/initial-value-overwritten'

    it('flags a parameter overwritten before it is read', async () => {
      const src = `class C { int M(int x) { x = 5; return x; } }`
      expect(await keys(src, K)).toContain(K)
    })

    it('does not flag a fallback that reads the parameter', async () => {
      const src = `class C { string M(string s) { s = s ?? ""; return s; } }`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag x = x + 1 (reads the incoming value)', async () => {
      const src = `class C { int M(int x) { x = x + 1; return x; } }`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag a read before the write', async () => {
      const src = `using System;
class C { int M(int x) { Console.Write(x); x = 5; return x; } }`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag a ref parameter', async () => {
      const src = `class C { void M(ref int x) { x = 5; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- valuetask-consumed-incorrectly ------------------------------------
  describe('valuetask-consumed-incorrectly', () => {
    const K = 'bugs/deterministic/valuetask-consumed-incorrectly'

    it('flags a ValueTask awaited twice', async () => {
      const src = `using System.Threading.Tasks;
class C {
  async Task M(ValueTask vt) { await vt; await vt; }
}`
      expect(await keys(src, K)).toContain(K)
    })

    it('flags await then .Result', async () => {
      const src = `using System.Threading.Tasks;
class C {
  async Task M(ValueTask<int> vt) { await vt; var x = vt.Result; }
}`
      expect(await keys(src, K)).toContain(K)
    })

    it('does not flag a single await', async () => {
      const src = `using System.Threading.Tasks;
class C { async Task M(ValueTask vt) { await vt; } }`
      expect(await keys(src, K)).not.toContain(K)
    })

    it('does not flag a Task awaited twice', async () => {
      const src = `using System.Threading.Tasks;
class C { async Task M(Task t) { await t; await t; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })
})
