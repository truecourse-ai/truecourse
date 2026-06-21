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
    it('flags a public method on an internal type', async () => {
      const src = `
internal class Helper {
  public void Do() {}
}`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a public method on a public type', async () => {
      const src = `
public class Helper {
  public void Do() {}
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag an internal member on an internal type', async () => {
      const src = `
internal class Helper {
  internal void Do() {}
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
  })
})
