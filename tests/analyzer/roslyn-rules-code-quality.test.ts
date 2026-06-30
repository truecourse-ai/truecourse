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

describe.skipIf(!hostBuilt)('Roslyn host — code-quality rules (semantic C#)', () => {
  // ---- array-for-params-argument -----------------------------------------
  describe('array-for-params-argument', () => {
    const K = 'code-quality/deterministic/array-for-params-argument'
    it('flags an explicit array passed to a params parameter', async () => {
      const src = `
class C {
  void Log(params int[] xs) {}
  void M() { Log(new int[] { 1, 2, 3 }); }
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags an implicitly-typed array passed to params', async () => {
      const src = `
class C {
  void Log(params string[] xs) {}
  void M() { Log(new[] { "a", "b" }); }
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag inline params arguments', async () => {
      const src = `
class C {
  void Log(params int[] xs) {}
  void M() { Log(1, 2, 3); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a non-params array parameter', async () => {
      const src = `
class C {
  void Log(int[] xs) {}
  void M() { Log(new int[] { 1, 2 }); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- cast-interface-to-concrete ----------------------------------------
  describe('cast-interface-to-concrete', () => {
    const K = 'code-quality/deterministic/cast-interface-to-concrete'
    it('flags casting an interface to its concrete type', async () => {
      const src = `
interface IShape {}
class Circle : IShape {}
class C { void M(IShape s) { var c = (Circle)s; } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags an as-cast from interface to concrete', async () => {
      const src = `
interface IShape {}
class Circle : IShape {}
class C { void M(IShape s) { var c = s as Circle; } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a cast to another interface', async () => {
      const src = `
interface IShape {}
interface IDrawable {}
class C { void M(IShape s) { var d = (IDrawable)s; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a cast from object', async () => {
      const src = `
class Circle {}
class C { void M(object o) { var c = (Circle)o; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- default-value-type-constructor ------------------------------------
  describe('default-value-type-constructor', () => {
    const K = 'code-quality/deterministic/default-value-type-constructor'
    it('flags new on a struct with no parameterless ctor', async () => {
      const src = `
struct Point { public int X; public int Y; }
class C { Point M() { return new Point(); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag default(T)', async () => {
      const src = `
struct Point { public int X; }
class C { Point M() { return default(Point); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag new on a class', async () => {
      const src = `
class Thing {}
class C { Thing M() { return new Thing(); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag new with arguments', async () => {
      const src = `
struct Point { public Point(int x) { X = x; } public int X; }
class C { Point M() { return new Point(1); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- equatable-without-iequatable --------------------------------------
  describe('equatable-without-iequatable', () => {
    const K = 'code-quality/deterministic/equatable-without-iequatable'
    it('flags a typed Equals without IEquatable<T>', async () => {
      const src = `
class Money {
  public int Amount;
  public bool Equals(Money other) => other != null && other.Amount == Amount;
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag when IEquatable<T> is implemented', async () => {
      const src = `
using System;
class Money : IEquatable<Money> {
  public int Amount;
  public bool Equals(Money other) => other != null && other.Amount == Amount;
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a record (synthesizes its own)', async () => {
      const src = `record Money(int Amount);`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag the object Equals override', async () => {
      const src = `
class Money {
  public override bool Equals(object other) => false;
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- explicit-default-argument -----------------------------------------
  describe('explicit-default-argument', () => {
    const K = 'code-quality/deterministic/explicit-default-argument'
    it('flags passing the same value as the parameter default', async () => {
      const src = `
class C {
  void Go(int retries = 3) {}
  void M() { Go(3); }
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags passing the default null', async () => {
      const src = `
class C {
  void Go(string name = null) {}
  void M() { Go(null); }
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a non-default value', async () => {
      const src = `
class C {
  void Go(int retries = 3) {}
  void M() { Go(5); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a required argument', async () => {
      const src = `
class C {
  void Go(int retries) {}
  void M() { Go(3); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- extension-method-namespace ----------------------------------------
  describe('extension-method-namespace', () => {
    const K = 'code-quality/deterministic/extension-method-namespace'
    it('flags an extension in the same namespace as the extended type', async () => {
      const src = `
namespace App {
  class Widget {}
  static class WidgetExtensions {
    public static int Size(this Widget w) => 0;
  }
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag an extension in a different namespace', async () => {
      const src = `
namespace App { class Widget {} }
namespace App.Extensions {
  static class WidgetExtensions {
    public static int Size(this App.Widget w) => 0;
  }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag an extension on a framework type', async () => {
      const src = `
namespace App {
  static class StringExtensions {
    public static int Twice(this string s) => s.Length * 2;
  }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- field-can-be-readonly ---------------------------------------------
  describe('field-can-be-readonly', () => {
    const K = 'code-quality/deterministic/field-can-be-readonly'
    it('flags a private field assigned only in the constructor', async () => {
      const src = `
class C {
  private int _x;
  public C(int x) { _x = x; }
  public int Get() => _x;
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags a private field assigned only inline', async () => {
      const src = `
class C {
  private int _x = 5;
  public int Get() => _x;
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a field reassigned in a method', async () => {
      const src = `
class C {
  private int _x;
  public C() { _x = 1; }
  public void Bump() { _x++; }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag an already-readonly field', async () => {
      const src = `
class C {
  private readonly int _x = 5;
  public int Get() => _x;
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a public field', async () => {
      const src = `
class C {
  public int X;
  public C(int x) { X = x; }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a field passed by ref', async () => {
      const src = `
class C {
  private int _x;
  public C() { _x = 0; Init(ref _x); }
  private static void Init(ref int v) { v = 1; }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- generic-logger-wrong-type -----------------------------------------
  describe('generic-logger-wrong-type', () => {
    const K = 'code-quality/deterministic/generic-logger-wrong-type'
    const LOGGER = `
namespace Microsoft.Extensions.Logging {
  public interface ILogger<out T> {}
}`
    it('flags ILogger<T> where T is not the enclosing type', async () => {
      const src = `${LOGGER}
class Other {}
class Service {
  public Service(Microsoft.Extensions.Logging.ILogger<Other> log) {}
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag ILogger<T> matching the enclosing type', async () => {
      const src = `${LOGGER}
class Service {
  public Service(Microsoft.Extensions.Logging.ILogger<Service> log) {}
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- identifier-matches-keyword ----------------------------------------
  describe('identifier-matches-keyword', () => {
    const K = 'code-quality/deterministic/identifier-matches-keyword'
    it('flags a public type named like a VB keyword', async () => {
      const src = `public class Handles {}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag an ordinary type name', async () => {
      const src = `public class Customer {}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag an internal type matching a keyword', async () => {
      const src = `internal class Shared {}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- indexof-for-presence-check ----------------------------------------
  describe('indexof-for-presence-check', () => {
    const K = 'code-quality/deterministic/indexof-for-presence-check'
    it('flags IndexOf(...) >= 0', async () => {
      const src = `
class C { bool M(string s) { return s.IndexOf("x") >= 0; } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags IndexOf(...) == -1', async () => {
      const src = `
class C { bool M(string s) { return s.IndexOf("x") == -1; } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag IndexOf compared to a real position', async () => {
      const src = `
class C { bool M(string s) { return s.IndexOf("x") > 3; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag List.IndexOf', async () => {
      const src = `
using System.Collections.Generic;
class C { bool M(List<int> xs) { return xs.IndexOf(1) >= 0; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- inconsistent-operator-overloads -----------------------------------
  describe('inconsistent-operator-overloads', () => {
    const K = 'code-quality/deterministic/inconsistent-operator-overloads'
    it('flags < without >', async () => {
      const src = `
class C {
  public static bool operator <(C a, C b) => true;
  // missing operator >
  public static bool operator <=(C a, C b) => true;
  public static bool operator >=(C a, C b) => true;
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a complete relational set', async () => {
      const src = `
class C {
  public static bool operator <(C a, C b) => true;
  public static bool operator >(C a, C b) => true;
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a type with no operators', async () => {
      const src = `class C { public int X; }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- logger-named-for-wrong-type ---------------------------------------
  describe('logger-named-for-wrong-type', () => {
    const K = 'code-quality/deterministic/logger-named-for-wrong-type'
    const FACTORY = `
namespace Microsoft.Extensions.Logging {
  public interface ILogger<out T> {}
  public interface ILoggerFactory {
    ILogger<T> CreateLogger<T>();
  }
}`
    it('flags CreateLogger<Other> inside a different type', async () => {
      const src = `${FACTORY}
class Other {}
class Service {
  void M(Microsoft.Extensions.Logging.ILoggerFactory f) {
    var log = f.CreateLogger<Other>();
  }
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag CreateLogger<Service> inside Service', async () => {
      const src = `${FACTORY}
class Service {
  void M(Microsoft.Extensions.Logging.ILoggerFactory f) {
    var log = f.CreateLogger<Service>();
  }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- member-more-visible-than-type -------------------------------------
  describe('member-more-visible-than-type', () => {
    const K = 'code-quality/deterministic/member-more-visible-than-type'
    it('flags a public member on a private nested type', async () => {
      const src = `
public class Outer {
  private class Helper {
    public void Do() {}
  }
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a public member on an internal type (reachable across the assembly)', async () => {
      const src = `
internal class Helper {
  public void Do() {}
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a public method on a public type', async () => {
      const src = `
public class Helper {
  public void Do() {}
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag an internal member on a private nested type', async () => {
      const src = `
public class Outer {
  private class Helper {
    internal void Do() {}
  }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- non-abstract-attribute-not-sealed ---------------------------------
  describe('non-abstract-attribute-not-sealed', () => {
    const K = 'code-quality/deterministic/non-abstract-attribute-not-sealed'
    it('flags an unsealed concrete attribute', async () => {
      const src = `
using System;
class MyAttribute : Attribute {}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a sealed attribute', async () => {
      const src = `
using System;
sealed class MyAttribute : Attribute {}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag an abstract attribute', async () => {
      const src = `
using System;
abstract class MyAttribute : Attribute {}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a non-attribute class', async () => {
      const src = `class Plain {}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- operator-without-named-alternative --------------------------------
  describe('operator-without-named-alternative', () => {
    const K = 'code-quality/deterministic/operator-without-named-alternative'
    it('flags operator + with no Add method', async () => {
      const src = `
class Vec {
  public static Vec operator +(Vec a, Vec b) => a;
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag operator + when an Add method exists', async () => {
      const src = `
class Vec {
  public static Vec operator +(Vec a, Vec b) => a;
  public static Vec Add(Vec a, Vec b) => a;
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- static-holder-type-not-sealed -------------------------------------
  describe('static-holder-type-not-sealed', () => {
    const K = 'code-quality/deterministic/static-holder-type-not-sealed'
    it('flags an all-static class that is neither static nor sealed', async () => {
      const src = `
class Helpers {
  public static int Add(int a, int b) => a + b;
  public static int Zero = 0;
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a static class', async () => {
      const src = `
static class Helpers {
  public static int Add(int a, int b) => a + b;
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a class with an instance member', async () => {
      const src = `
class Helpers {
  public static int Add(int a, int b) => a + b;
  public int Instance() => 1;
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- use-pattern-over-is-and-cast --------------------------------------
  describe('use-pattern-over-is-and-cast', () => {
    const K = 'code-quality/deterministic/use-pattern-over-is-and-cast'
    it('flags is T followed by a (T) cast of the same value', async () => {
      const src = `
class Animal {}
class Dog : Animal { public void Bark() {} }
class C {
  void M(Animal a) {
    if (a is Dog) { ((Dog)a).Bark(); }
  }
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a type-pattern that already binds', async () => {
      const src = `
class Animal {}
class Dog : Animal { public void Bark() {} }
class C {
  void M(Animal a) {
    if (a is Dog d) { d.Bark(); }
  }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag an is-check without a matching cast', async () => {
      const src = `
class Animal {}
class Dog : Animal {}
class C {
  bool M(Animal a) { return a is Dog; }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- writable-collection-property --------------------------------------
  describe('writable-collection-property', () => {
    const K = 'code-quality/deterministic/writable-collection-property'
    it('flags a List property with a public setter', async () => {
      const src = `
using System.Collections.Generic;
class C { public List<int> Items { get; set; } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a get-only collection property', async () => {
      const src = `
using System.Collections.Generic;
class C { public List<int> Items { get; } = new(); }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag an IReadOnlyList property with a setter', async () => {
      const src = `
using System.Collections.Generic;
class C { public IReadOnlyList<int> Items { get; set; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag an array property', async () => {
      const src = `
class C { public int[] Items { get; set; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag an init-only collection property', async () => {
      const src = `
using System.Collections.Generic;
class C { public List<int> Items { get; init; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a [Parameter] collection property (Blazor binding)', async () => {
      const src = `
using System.Collections.Generic;
class ParameterAttribute : System.Attribute {}
class C {
  [Parameter] public List<string> BreadcrumbItems { get; set; }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a [CascadingParameter] collection property', async () => {
      const src = `
using System.Collections.Generic;
class CascadingParameterAttribute : System.Attribute {}
class C {
  [CascadingParameter] public List<string> Items { get; set; }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- write-only-property -----------------------------------------------
  describe('write-only-property', () => {
    const K = 'code-quality/deterministic/write-only-property'
    it('flags a property with only a setter', async () => {
      const src = `
class C { private int _x; public int X { set { _x = value; } } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a get/set property', async () => {
      const src = `
class C { public int X { get; set; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a get-only property', async () => {
      const src = `
class C { public int X { get; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag an override forced to be write-only', async () => {
      const src = `
abstract class B { public abstract int X { set; } }
class C : B { public override int X { set {} } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- local-shadows-field -----------------------------------------------
  describe('local-shadows-field', () => {
    const K = 'code-quality/deterministic/local-shadows-field'
    it('flags a local that shadows a field', async () => {
      const src = `
class C {
  private int count;
  void M() { int count = 3; System.Console.WriteLine(count); }
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags a parameter that shadows a property', async () => {
      const src = `
class C {
  public int Total { get; set; }
  void M(int Total) { System.Console.WriteLine(Total); }
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a local with a unique name', async () => {
      const src = `
class C {
  private int count;
  void M() { int n = 3; System.Console.WriteLine(n); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a local shadowing a static member', async () => {
      const src = `
class C {
  private static int count;
  void M() { int count = 3; System.Console.WriteLine(count); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- redundant-async-await ---------------------------------------------
  describe('redundant-async-await', () => {
    const K = 'code-quality/deterministic/redundant-async-await'
    it('flags an async method that only returns an awaited task', async () => {
      const src = `
using System.Threading.Tasks;
class C {
  Task<int> Inner() => Task.FromResult(1);
  async Task<int> M() { return await Inner(); }
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags an expression-bodied redundant await', async () => {
      const src = `
using System.Threading.Tasks;
class C {
  Task<int> Inner() => Task.FromResult(1);
  async Task<int> M() => await Inner();
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag await inside a try block', async () => {
      const src = `
using System.Threading.Tasks;
class C {
  Task<int> Inner() => Task.FromResult(1);
  async Task<int> M() { try { return await Inner(); } finally {} }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a method with statements before the await', async () => {
      const src = `
using System.Threading.Tasks;
class C {
  Task<int> Inner() => Task.FromResult(1);
  async Task<int> M() { var x = 1; return await Inner(); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- use-argumentnullexception-throwifnull ------------------------------
  describe('use-argumentnullexception-throwifnull', () => {
    const K = 'code-quality/deterministic/use-argumentnullexception-throwifnull'
    it('flags a manual == null guard throwing ArgumentNullException', async () => {
      const src = `
using System;
class C {
  void M(string s) { if (s == null) throw new ArgumentNullException(nameof(s)); }
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags an is null guard', async () => {
      const src = `
using System;
class C {
  void M(object o) { if (o is null) throw new ArgumentNullException(nameof(o)); }
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a guard throwing a different exception', async () => {
      const src = `
using System;
class C {
  void M(string s) { if (s == null) throw new InvalidOperationException(); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a non-null comparison', async () => {
      const src = `
using System;
class C {
  void M(int n) { if (n == 0) throw new ArgumentException(); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- use-nameof-for-member ----------------------------------------------
  describe('use-nameof-for-member', () => {
    const K = 'code-quality/deterministic/use-nameof-for-member'
    it('flags a literal param name matching a parameter', async () => {
      const src = `
using System;
class C {
  void M(string value) { throw new ArgumentNullException("value"); }
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag nameof usage', async () => {
      const src = `
using System;
class C {
  void M(string value) { throw new ArgumentNullException(nameof(value)); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a literal that matches no parameter', async () => {
      const src = `
using System;
class C {
  void M(string value) { throw new ArgumentNullException("other"); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- tuple-element-by-name ----------------------------------------------
  describe('tuple-element-by-name', () => {
    const K = 'code-quality/deterministic/tuple-element-by-name'
    it('flags Item1 access when a name is declared', async () => {
      const src = `
class C {
  (int Count, string Name) Get() => (1, "a");
  void M() { var t = Get(); System.Console.WriteLine(t.Item1); }
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag access by the declared name', async () => {
      const src = `
class C {
  (int Count, string Name) Get() => (1, "a");
  void M() { var t = Get(); System.Console.WriteLine(t.Count); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag Item1 on an unnamed tuple', async () => {
      const src = `
class C {
  (int, string) Get() => (1, "a");
  void M() { var t = Get(); System.Console.WriteLine(t.Item1); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- return-value-never-used --------------------------------------------
  describe('return-value-never-used', () => {
    const K = 'code-quality/deterministic/return-value-never-used'
    it('flags a private method whose result is always discarded', async () => {
      const src = `
class C {
  private int Compute() { return 1; }
  void M() { Compute(); Compute(); }
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag when the result is used at a call site', async () => {
      const src = `
class C {
  private int Compute() { return 1; }
  void M() { int x = Compute(); System.Console.WriteLine(x); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a public method', async () => {
      const src = `
class C {
  public int Compute() { return 1; }
  void M() { Compute(); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- static-field-initialize-inline -------------------------------------
  describe('static-field-initialize-inline', () => {
    const K = 'code-quality/deterministic/static-field-initialize-inline'
    it('flags a static field assigned only in the static ctor', async () => {
      const src = `
class C {
  private static int Value;
  static C() { Value = 42; }
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a field with an inline initializer', async () => {
      const src = `
class C {
  private static int Value = 42;
  static C() { System.Console.WriteLine(Value); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a field assigned conditionally', async () => {
      const src = `
class C {
  private static int Value;
  static C() { if (true) { Value = 1; } }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- obsolete-without-explanation ---------------------------------------
  describe('obsolete-without-explanation', () => {
    const K = 'code-quality/deterministic/obsolete-without-explanation'
    it('flags [Obsolete] with no message', async () => {
      const src = `
using System;
class C { [Obsolete] public void Old() {} }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags [Obsolete] with an empty message', async () => {
      const src = `
using System;
class C { [Obsolete("")] public void Old() {} }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag [Obsolete] with a message', async () => {
      const src = `
using System;
class C { [Obsolete("Use New() instead.")] public void Old() {} }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- non-testable-datetime-provider -------------------------------------
  describe('non-testable-datetime-provider', () => {
    const K = 'code-quality/deterministic/non-testable-datetime-provider'
    it('flags DateTime.Now', async () => {
      const src = `
using System;
class C { DateTime M() { return DateTime.Now; } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags DateTime.UtcNow', async () => {
      const src = `
using System;
class C { DateTime M() { return DateTime.UtcNow; } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a parsed DateTime', async () => {
      const src = `
using System;
class C { DateTime M(string s) { return DateTime.Parse(s); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- unused-this-parameter ----------------------------------------------
  describe('unused-this-parameter', () => {
    const K = 'code-quality/deterministic/unused-this-parameter'
    it('flags a private method that never uses instance state', async () => {
      const src = `
class C {
  private int _x;
  private int Add(int a, int b) { return a + b; }
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a private method that reads a field', async () => {
      const src = `
class C {
  private int _x;
  private int Get(int n) { return _x + n; }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a public method (making it static would change the API)', async () => {
      const src = `
class C {
  public int Add(int a, int b) { return a + b; }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a protected method (part of the inheritance surface)', async () => {
      const src = `
class C {
  protected int Add(int a, int b) { return a + b; }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag an override', async () => {
      const src = `
class B { protected virtual int F(int n) { return 0; } }
class C : B { protected override int F(int n) { return 1; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- inner-member-shadows-outer -----------------------------------------
  describe('inner-member-shadows-outer', () => {
    const K = 'code-quality/deterministic/inner-member-shadows-outer'
    it('flags a nested member shadowing an outer static field', async () => {
      const src = `
class Outer {
  private static int Shared;
  class Inner { public int Shared; }
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag when names differ', async () => {
      const src = `
class Outer {
  private static int Shared;
  class Inner { public int Other; }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag shadowing an outer instance member', async () => {
      const src = `
class Outer {
  private int Shared;
  class Inner { public int Shared; }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- use-argumentexception-throwhelper ----------------------------------
  describe('use-argumentexception-throwhelper', () => {
    const K = 'code-quality/deterministic/use-argumentexception-throwhelper'
    it('flags a manual IsNullOrEmpty guard throwing ArgumentException', async () => {
      const src = `
using System;
class C {
  void M(string s) { if (string.IsNullOrEmpty(s)) throw new ArgumentException("empty", nameof(s)); }
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags a manual IsNullOrWhiteSpace guard', async () => {
      const src = `
using System;
class C {
  void M(string s) { if (string.IsNullOrWhiteSpace(s)) throw new ArgumentException("ws", nameof(s)); }
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a guard throwing a different exception', async () => {
      const src = `
using System;
class C {
  void M(string s) { if (string.IsNullOrEmpty(s)) throw new InvalidOperationException(); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- use-argumentoutofrange-throwhelper ---------------------------------
  describe('use-argumentoutofrange-throwhelper', () => {
    const K = 'code-quality/deterministic/use-argumentoutofrange-throwhelper'
    it('flags a manual range guard throwing ArgumentOutOfRangeException', async () => {
      const src = `
using System;
class C {
  void M(int n) { if (n < 0) throw new ArgumentOutOfRangeException(nameof(n)); }
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a guard throwing ArgumentException', async () => {
      const src = `
using System;
class C {
  void M(int n) { if (n < 0) throw new ArgumentException(); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a compound condition', async () => {
      const src = `
using System;
class C {
  void M(int n) { if (n < 0 && n > 100) throw new ArgumentOutOfRangeException(nameof(n)); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- interface-colliding-base-members -----------------------------------
  describe('interface-colliding-base-members', () => {
    const K = 'code-quality/deterministic/interface-colliding-base-members'
    it('flags an interface inheriting a colliding member from two bases', async () => {
      const src = `
interface IA { void Run(); }
interface IB { void Run(); }
interface IC : IA, IB {}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag when the derived interface redeclares the member', async () => {
      const src = `
interface IA { void Run(); }
interface IB { void Run(); }
interface IC : IA, IB { new void Run(); }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag non-colliding base interfaces', async () => {
      const src = `
interface IA { void Start(); }
interface IB { void Stop(); }
interface IC : IA, IB {}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag diamond inheritance (single member declaration via two paths)', async () => {
      const src = `
interface IBase { void Run(); }
interface IA : IBase {}
interface IB : IBase {}
interface IC : IA, IB {}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag overloads with different signatures from the same base', async () => {
      const src = `
interface IA { void Fetch(int id); void Fetch(int id, string filter); }
interface IB { void Other(); }
interface IC : IA, IB {}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- inline-single-use-local --------------------------------------------
  describe('inline-single-use-local', () => {
    const K = 'code-quality/deterministic/inline-single-use-local'
    it('flags a local used once on the next statement', async () => {
      const src = `
class C {
  int M() {
    var x = Compute();
    return x;
  }
  int Compute() => 1;
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a local used twice', async () => {
      const src = `
class C {
  int M() {
    var x = Compute();
    return x + x;
  }
  int Compute() => 1;
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a local used after an intervening statement', async () => {
      const src = `
class C {
  int M() {
    var x = Compute();
    System.Console.WriteLine("hi");
    return x;
  }
  int Compute() => 1;
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- local-could-be-const -----------------------------------------------
  describe('local-could-be-const', () => {
    const K = 'code-quality/deterministic/local-could-be-const'
    it('flags a constant int local never reassigned', async () => {
      const src = `
class C {
  int M() { int x = 5; return x + 1; }
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a reassigned local', async () => {
      const src = `
class C {
  int M() { int x = 5; x = 6; return x; }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a non-constant initializer', async () => {
      const src = `
class C {
  int M(int a) { int x = a; return x; }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a var declaration', async () => {
      const src = `
class C {
  int M() { var x = 5; return x; }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- log-placeholder-not-pascalcase -------------------------------------
  describe('log-placeholder-not-pascalcase', () => {
    const K = 'code-quality/deterministic/log-placeholder-not-pascalcase'
    // Microsoft.Extensions.Logging is not in the host reference set, so the test
    // declares a minimal ILogger with the LogXxx methods the rule recognizes.
    const LOGGER = `
namespace Microsoft.Extensions.Logging {
  public interface ILogger {
    void LogInformation(string message, params object[] args);
  }
}`
    it('flags a camelCase placeholder name', async () => {
      const src = `${LOGGER}
class C {
  void M(Microsoft.Extensions.Logging.ILogger logger, int userId) { logger.LogInformation("User {userId} signed in", userId); }
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a PascalCase placeholder', async () => {
      const src = `${LOGGER}
class C {
  void M(Microsoft.Extensions.Logging.ILogger logger, int userId) { logger.LogInformation("User {UserId} signed in", userId); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a positional index placeholder', async () => {
      const src = `${LOGGER}
class C {
  void M(Microsoft.Extensions.Logging.ILogger logger, int id) { logger.LogInformation("User {0} signed in", id); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- identifier-contains-type-name --------------------------------------
  describe('identifier-contains-type-name', () => {
    const K = 'code-quality/deterministic/identifier-contains-type-name'
    it('flags a parameter named String', async () => {
      const src = `
class C { void M(string String) { System.Console.WriteLine(String); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags a property named Integer', async () => {
      const src = `
class C { public int Integer { get; set; } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a descriptive name', async () => {
      const src = `
class C { void M(string name) { System.Console.WriteLine(name); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a name that merely contains a type token', async () => {
      const src = `
class C { void M(string stringBuilder) { System.Console.WriteLine(stringBuilder); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- indexer-non-standard-key-type --------------------------------------
  describe('indexer-non-standard-key-type', () => {
    const K = 'code-quality/deterministic/indexer-non-standard-key-type'
    it('flags an indexer keyed by an enum', async () => {
      const src = `
enum Color { Red, Green }
class Palette { public string this[Color c] => ""; }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags an indexer keyed by a custom struct', async () => {
      const src = `
struct Key { public int V; }
class Store { public int this[Key k] => 0; }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a string-keyed indexer', async () => {
      const src = `
class Store { public int this[string name] => 0; }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag an int-keyed indexer', async () => {
      const src = `
class Store { public int this[int i] => 0; }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a generic type-parameter key', async () => {
      const src = `
class Store<TKey> { public int this[TKey k] => 0; }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- literal-as-localized-parameter -------------------------------------
  describe('literal-as-localized-parameter', () => {
    const K = 'code-quality/deterministic/literal-as-localized-parameter'
    it('flags a literal passed to a [Localizable(true)] parameter', async () => {
      const src = `
using System.ComponentModel;
class C {
  void Show([Localizable(true)] string caption) {}
  void M() { Show("Hello"); }
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a literal to a non-localizable parameter', async () => {
      const src = `
class C {
  void Show(string caption) {}
  void M() { Show("Hello"); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a [Localizable(false)] parameter', async () => {
      const src = `
using System.ComponentModel;
class C {
  void Show([Localizable(false)] string key) {}
  void M() { Show("settings.key"); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag an empty string literal', async () => {
      const src = `
using System.ComponentModel;
class C {
  void Show([Localizable(true)] string caption) {}
  void M() { Show(""); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- locale-not-set -----------------------------------------------------
  describe('locale-not-set', () => {
    const K = 'code-quality/deterministic/locale-not-set'
    it('flags a DataTable created without a Locale', async () => {
      const src = `
using System.Data;
class C { DataTable M() => new DataTable(); }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a DataTable with Locale set in initializer', async () => {
      const src = `
using System.Data;
using System.Globalization;
class C { DataTable M() => new DataTable { Locale = CultureInfo.InvariantCulture }; }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag an unrelated type', async () => {
      const src = `
class Thing {}
class C { Thing M() => new Thing(); }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- missing-generic-variance -------------------------------------------
  describe('missing-generic-variance', () => {
    const K = 'code-quality/deterministic/missing-generic-variance'
    it('flags an output-only interface type parameter', async () => {
      const src = `
interface IReader<T> { T Read(); }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a type parameter also used as input', async () => {
      const src = `
interface IStore<T> { T Read(); void Write(T value); }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag an already-covariant out parameter', async () => {
      const src = `
interface IReader<out T> { T Read(); }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag an input-only type parameter', async () => {
      const src = `
interface IWriter<T> { void Write(T value); }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- optional-parameter-hazard ------------------------------------------
  describe('optional-parameter-hazard', () => {
    const K = 'code-quality/deterministic/optional-parameter-hazard'
    it('flags an optional parameter on a public method', async () => {
      const src = `
public class C { public void Log(string msg, int level = 0) {} }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a required parameter', async () => {
      const src = `
public class C { public void Log(string msg, int level) {} }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag an optional parameter on a private method', async () => {
      const src = `
public class C { void Log(string msg, int level = 0) {} }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag an optional parameter on an override', async () => {
      const src = `
public class B { public virtual void Log(int level = 0) {} }
public class C : B { public override void Log(int level = 0) {} }`
      const result = await keys(src, K)
      // The base declaration is still flagged, but the override must not be.
      expect(result.filter((k) => k === K).length).toBe(1)
    })
  })

  // ---- override-parameter-name-mismatch -----------------------------------
  describe('override-parameter-name-mismatch', () => {
    const K = 'code-quality/deterministic/override-parameter-name-mismatch'
    it('flags an override with a renamed parameter', async () => {
      const src = `
class B { public virtual void Save(int id) {} }
class C : B { public override void Save(int key) {} }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags an interface implementation with a renamed parameter', async () => {
      const src = `
interface IStore { void Put(string key); }
class C : IStore { public void Put(string name) {} }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag matching parameter names', async () => {
      const src = `
class B { public virtual void Save(int id) {} }
class C : B { public override void Save(int id) {} }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- traceswitch-writelineif-misuse -------------------------------------
  describe('traceswitch-writelineif-misuse', () => {
    const K = 'code-quality/deterministic/traceswitch-writelineif-misuse'
    it('flags WriteLineIf gated on a TraceSwitch Level', async () => {
      const src = `
using System.Diagnostics;
class C {
  static TraceSwitch sw = new TraceSwitch("a", "b");
  void M() { Trace.WriteLineIf(sw.Level == TraceLevel.Error, "boom"); }
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag WriteLineIf on a plain boolean condition', async () => {
      const src = `
using System.Diagnostics;
class C { void M(bool flag) { Trace.WriteLineIf(flag, "msg"); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag the recommended boolean property usage', async () => {
      const src = `
using System.Diagnostics;
class C {
  static TraceSwitch sw = new TraceSwitch("a", "b");
  void M() { Trace.WriteLineIf(sw.TraceError, "boom"); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- type-name-matches-namespace ----------------------------------------
  describe('type-name-matches-namespace', () => {
    const K = 'code-quality/deterministic/type-name-matches-namespace'
    it('flags a type sharing a declared namespace name', async () => {
      const src = `
namespace Logging { class Sink {} }
namespace App { class Logging {} }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a type with a unique name', async () => {
      const src = `
namespace Logging { class Sink {} }
namespace App { class Reporter {} }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a nested type even when a sibling namespace shares the name', async () => {
      const src = `
namespace App.Bundles { class Styles {} }
namespace App { class StandardBundles { class Styles {} } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- property-matches-get-method ----------------------------------------
  describe('property-matches-get-method', () => {
    const K = 'code-quality/deterministic/property-matches-get-method'
    it('flags a GetFoo method colliding with a Foo property', async () => {
      const src = `
class C {
  public int Value { get; }
  public int GetValue() => Value;
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a Get method without a matching property', async () => {
      const src = `
class C { public int GetValue() => 1; }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a Get method that takes parameters', async () => {
      const src = `
class C {
  public int Value { get; }
  public int GetValue(int scale) => Value * scale;
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- verbose-declaration-initialization ---------------------------------
  describe('verbose-declaration-initialization', () => {
    const K = 'code-quality/deterministic/verbose-declaration-initialization'
    it('flags a declaration repeating the type on both sides', async () => {
      const src = `
using System.Collections.Generic;
class C { void M() { List<int> xs = new List<int>(); xs.Add(1); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag var', async () => {
      const src = `
using System.Collections.Generic;
class C { void M() { var xs = new List<int>(); xs.Add(1); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a base/interface-typed declaration', async () => {
      const src = `
using System.Collections.Generic;
class C { void M() { IList<int> xs = new List<int>(); xs.Add(1); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag target-typed new', async () => {
      const src = `
using System.Collections.Generic;
class C { void M() { List<int> xs = new(); xs.Add(1); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- unused-function-parameter ------------------------------------------
  describe('unused-function-parameter', () => {
    const K = 'code-quality/deterministic/unused-function-parameter'
    it('flags a parameter never read in the body', async () => {
      const src = `
class C {
  public decimal ApplyDiscount(decimal price, string promoCode) => price * 0.9m;
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a parameter that is read', async () => {
      const src = `
class C {
  public decimal ApplyDiscount(decimal price, string code) {
    if (code == "HALF") return price * 0.5m;
    return price * 0.9m;
  }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag an implicit interface implementation (mandated signature)', async () => {
      const src = `
interface IProvider { string Get(string category); }
class NullProvider : IProvider {
  public string Get(string category) => "default";
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag an override', async () => {
      const src = `
class Base { public virtual void Run(string ctx) {} }
class Derived : Base { public override void Run(string ctx) { } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a parameter prefixed with _', async () => {
      const src = `
class C { public void Handle(string _reason) { System.Console.WriteLine("done"); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a NotImplementedException stub', async () => {
      const src = `
class C {
  public void Process(string input) { throw new System.NotImplementedException(); }
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })
})
