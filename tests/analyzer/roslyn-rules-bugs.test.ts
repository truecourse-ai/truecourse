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

  // ---- reference-equals-on-value-type (S2995) ----------------------------
  describe('reference-equals-on-value-type', () => {
    const K = 'bugs/deterministic/reference-equals-on-value-type'
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
})
