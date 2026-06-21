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

/** Like `keys`, but returns the violation messages (for asserting on the subject). */
async function messages(text: string, ruleKey: string): Promise<string[]> {
  const violations = await runRoslynHost([{ path: 'Test.cs', text }], [ruleKey])
  return violations.map((v) => v.message)
}

describe.skipIf(!hostBuilt)('Roslyn host — performance rules (semantic C#)', () => {
  // ---- count-instead-of-any ----------------------------------------------
  describe('count-instead-of-any', () => {
    const K = 'performance/deterministic/count-instead-of-any'
    it('flags Count() > 0', async () => {
      const src = `
using System.Collections.Generic;
using System.Linq;
class C { bool M(IEnumerable<int> xs) { return xs.Count() > 0; } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags Count() == 0', async () => {
      const src = `
using System.Collections.Generic;
using System.Linq;
class C { bool M(IEnumerable<int> xs) { return xs.Count() == 0; } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag List.Count property', async () => {
      const src = `
using System.Collections.Generic;
class C { bool M(List<int> xs) { return xs.Count > 0; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag Count() compared to a non-zero value', async () => {
      const src = `
using System.Collections.Generic;
using System.Linq;
class C { bool M(IEnumerable<int> xs) { return xs.Count() > 5; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- any-over-count-check ----------------------------------------------
  describe('any-over-count-check', () => {
    const K = 'performance/deterministic/any-over-count-check'
    it('flags Any() on an array', async () => {
      const src = `
using System.Linq;
class C { bool M(int[] xs) { return xs.Any(); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags Any() on a List', async () => {
      const src = `
using System.Collections.Generic;
using System.Linq;
class C { bool M(List<int> xs) { return xs.Any(); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag Any(predicate)', async () => {
      const src = `
using System.Linq;
class C { bool M(int[] xs) { return xs.Any(x => x > 0); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag Any() on a bare IEnumerable (no cheap Count)', async () => {
      const src = `
using System.Collections.Generic;
using System.Linq;
class C { bool M(IEnumerable<int> xs) { return xs.Any(); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- prefer-array-find -------------------------------------------------
  describe('prefer-array-find', () => {
    const K = 'performance/deterministic/prefer-array-find'
    it('flags FirstOrDefault(predicate) on an array', async () => {
      const src = `
using System.Linq;
class C { int M(int[] xs) { return xs.FirstOrDefault(x => x > 0); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags FirstOrDefault(predicate) on a List', async () => {
      const src = `
using System.Collections.Generic;
using System.Linq;
class C { int M(List<int> xs) { return xs.FirstOrDefault(x => x > 0); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag FirstOrDefault on a bare IEnumerable', async () => {
      const src = `
using System.Collections.Generic;
using System.Linq;
class C { int M(IEnumerable<int> xs) { return xs.FirstOrDefault(x => x > 0); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag predicate-less FirstOrDefault', async () => {
      const src = `
using System.Linq;
class C { int M(int[] xs) { return xs.FirstOrDefault(); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- prefer-exists -----------------------------------------------------
  describe('prefer-exists', () => {
    const K = 'performance/deterministic/prefer-exists'
    it('flags Any(predicate) on a List', async () => {
      const src = `
using System.Collections.Generic;
using System.Linq;
class C { bool M(List<int> xs) { return xs.Any(x => x > 0); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag Any(predicate) on IEnumerable', async () => {
      const src = `
using System.Collections.Generic;
using System.Linq;
class C { bool M(IEnumerable<int> xs) { return xs.Any(x => x > 0); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- prefer-trueforall -------------------------------------------------
  describe('prefer-trueforall', () => {
    const K = 'performance/deterministic/prefer-trueforall'
    it('flags All(predicate) on an array', async () => {
      const src = `
using System.Linq;
class C { bool M(int[] xs) { return xs.All(x => x > 0); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag All(predicate) on IEnumerable', async () => {
      const src = `
using System.Collections.Generic;
using System.Linq;
class C { bool M(IEnumerable<int> xs) { return xs.All(x => x > 0); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- prefer-indexing-over-linq -----------------------------------------
  describe('prefer-indexing-over-linq', () => {
    const K = 'performance/deterministic/prefer-indexing-over-linq'
    it('flags First() on a List', async () => {
      const src = `
using System.Collections.Generic;
using System.Linq;
class C { int M(List<int> xs) { return xs.First(); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags ElementAt(i) on an array', async () => {
      const src = `
using System.Linq;
class C { int M(int[] xs) { return xs.ElementAt(2); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag First() on a non-indexable IEnumerable', async () => {
      const src = `
using System.Collections.Generic;
using System.Linq;
class C { int M(IEnumerable<int> xs) { return xs.First(); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag First(predicate)', async () => {
      const src = `
using System.Collections.Generic;
using System.Linq;
class C { int M(List<int> xs) { return xs.First(x => x > 0); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- prefer-linkedlist-first-last --------------------------------------
  describe('prefer-linkedlist-first-last', () => {
    const K = 'performance/deterministic/prefer-linkedlist-first-last'
    it('flags First() on a LinkedList', async () => {
      const src = `
using System.Collections.Generic;
using System.Linq;
class C { int M(LinkedList<int> xs) { return xs.First(); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag the First property access', async () => {
      const src = `
using System.Collections.Generic;
class C { object M(LinkedList<int> xs) { return xs.First; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- prefer-set-minmax-property ----------------------------------------
  describe('prefer-set-minmax-property', () => {
    const K = 'performance/deterministic/prefer-set-minmax-property'
    it('flags Min() on a SortedSet', async () => {
      const src = `
using System.Collections.Generic;
using System.Linq;
class C { int M(SortedSet<int> xs) { return xs.Min(); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag Min() on a HashSet', async () => {
      const src = `
using System.Collections.Generic;
using System.Linq;
class C { int M(HashSet<int> xs) { return xs.Min(); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- multiple-orderby --------------------------------------------------
  describe('multiple-orderby', () => {
    const K = 'performance/deterministic/multiple-orderby'
    it('flags OrderBy chained after OrderBy', async () => {
      const src = `
using System.Collections.Generic;
using System.Linq;
class C { IEnumerable<int> M(IEnumerable<int> xs) { return xs.OrderBy(x => x).OrderBy(x => -x); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag OrderBy then ThenBy', async () => {
      const src = `
using System.Collections.Generic;
using System.Linq;
class C { IEnumerable<int> M(IEnumerable<int> xs) { return xs.OrderBy(x => x).ThenBy(x => -x); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- empty-string-compared-with-equals ---------------------------------
  describe('empty-string-compared-with-equals', () => {
    const K = 'performance/deterministic/empty-string-compared-with-equals'
    it('flags s == ""', async () => {
      const src = `class C { bool M(string s) { return s == ""; } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags s.Equals("")', async () => {
      const src = `class C { bool M(string s) { return s.Equals(""); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag s == "non-empty"', async () => {
      const src = `class C { bool M(string s) { return s == "x"; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a non-string == ""-shaped comparison', async () => {
      const src = `class C { bool M(int n) { return n == 0; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- startswith-over-indexof-zero --------------------------------------
  describe('startswith-over-indexof-zero', () => {
    const K = 'performance/deterministic/startswith-over-indexof-zero'
    it('flags s.IndexOf(p) == 0', async () => {
      const src = `class C { bool M(string s, string p) { return s.IndexOf(p) == 0; } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag s.IndexOf(p) > 0', async () => {
      const src = `class C { bool M(string s, string p) { return s.IndexOf(p) > 0; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag List.IndexOf(x) == 0', async () => {
      const src = `
using System.Collections.Generic;
class C { bool M(List<int> xs, int x) { return xs.IndexOf(x) == 0; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- string-contains-char ----------------------------------------------
  describe('string-contains-char', () => {
    const K = 'performance/deterministic/string-contains-char'
    it('flags s.Contains("x")', async () => {
      const src = `class C { bool M(string s) { return s.Contains("x"); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag s.Contains("xy")', async () => {
      const src = `class C { bool M(string s) { return s.Contains("xy"); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag s.Contains(char)', async () => {
      const src = `class C { bool M(string s) { return s.Contains('x'); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- prefer-char-overload ----------------------------------------------
  describe('prefer-char-overload', () => {
    const K = 'performance/deterministic/prefer-char-overload'
    it('flags s.StartsWith("x")', async () => {
      const src = `class C { bool M(string s) { return s.StartsWith("x"); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags s.EndsWith("x")', async () => {
      const src = `class C { bool M(string s) { return s.EndsWith("x"); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag s.StartsWith("xy")', async () => {
      const src = `class C { bool M(string s) { return s.StartsWith("xy"); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag the comparison-overload StartsWith', async () => {
      const src = `
using System;
class C { bool M(string s) { return s.StartsWith("x", StringComparison.Ordinal); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- string-concat-in-loop ---------------------------------------------
  describe('string-concat-in-loop', () => {
    const K = 'performance/deterministic/string-concat-in-loop'
    it('flags string += inside a for loop', async () => {
      const src = `
class C { string M() { string s = ""; for (int i = 0; i < 10; i++) s += i; return s; } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags string += inside a foreach loop', async () => {
      const src = `
using System.Collections.Generic;
class C { string M(List<string> xs) { string s = ""; foreach (var x in xs) s += x; return s; } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag string += outside a loop', async () => {
      const src = `class C { string M() { string s = ""; s += "a"; return s; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag numeric += inside a loop', async () => {
      const src = `class C { int M() { int n = 0; for (int i = 0; i < 10; i++) n += i; return n; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- use-span-string-concat --------------------------------------------
  describe('use-span-string-concat', () => {
    const K = 'performance/deterministic/use-span-string-concat'
    it('flags string.Concat of Substring results', async () => {
      const src = `
class C { string M(string s) { return string.Concat(s.Substring(0, 2), s.Substring(2)); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag string.Concat of plain strings', async () => {
      const src = `class C { string M(string a, string b) { return string.Concat(a, b); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- redundant-contains-before-set-op ----------------------------------
  describe('redundant-contains-before-set-op', () => {
    const K = 'performance/deterministic/redundant-contains-before-set-op'
    it('flags Contains guard before Remove on a HashSet', async () => {
      const src = `
using System.Collections.Generic;
class C { void M(HashSet<int> s, int x) { if (s.Contains(x)) s.Remove(x); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags !Contains guard before Add on a HashSet', async () => {
      const src = `
using System.Collections.Generic;
class C { void M(HashSet<int> s, int x) { if (!s.Contains(x)) s.Add(x); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag Contains guarding a different operation', async () => {
      const src = `
using System.Collections.Generic;
class C { int n; void M(HashSet<int> s, int x) { if (s.Contains(x)) n++; } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag Contains/Remove on a List (Remove is void there)', async () => {
      const src = `
using System.Collections.Generic;
class C { void M(List<int> xs, int x) { if (xs.Contains(x)) xs.Remove(x); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a different element in the body', async () => {
      const src = `
using System.Collections.Generic;
class C { void M(HashSet<int> s, int x, int y) { if (s.Contains(x)) s.Remove(y); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- value-type-without-iequatable -------------------------------------
  describe('value-type-without-iequatable', () => {
    const K = 'performance/deterministic/value-type-without-iequatable'
    it('flags a struct overriding Equals without IEquatable<T>', async () => {
      const src = `
struct Point { public int X; public override bool Equals(object o) => o is Point p && p.X == X; public override int GetHashCode() => X; }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a struct implementing IEquatable<T>', async () => {
      const src = `
using System;
struct Point : IEquatable<Point> {
  public int X;
  public bool Equals(Point other) => other.X == X;
  public override bool Equals(object o) => o is Point p && Equals(p);
  public override int GetHashCode() => X;
}`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a record struct', async () => {
      const src = `record struct Point(int X);`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag a struct that does not override Equals', async () => {
      const src = `struct Point { public int X; }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- non-derived-private-class-not-sealed ------------------------------
  describe('non-derived-private-class-not-sealed', () => {
    const K = 'performance/deterministic/non-derived-private-class-not-sealed'
    it('flags a never-subclassed private nested class', async () => {
      const src = `
class Outer { private class Helper { public int X; } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a private base class that is subclassed', async () => {
      // Base has a subclass, so it must not be flagged. (Derived is a leaf and may
      // legitimately be flagged — CA1852 reports leaf classes — so we assert on the
      // subject rather than on the rule key being entirely absent.)
      const src = `
class Outer { private class Base { } private class Derived : Base { } }`
      const msgs = await messages(src, K)
      expect(msgs.some((m) => m.includes('Class Base '))).toBe(false)
    })
    it('does not flag a sealed private class', async () => {
      const src = `
class Outer { private sealed class Helper { } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag an internal/public class (cross-assembly view incomplete)', async () => {
      const src = `public class Service { }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag an abstract private class', async () => {
      const src = `class Outer { private abstract class Base { } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- concurrentdictionary-captures-argument ----------------------------
  describe('concurrentdictionary-captures-argument', () => {
    const K = 'performance/deterministic/concurrentdictionary-captures-argument'
    it('flags GetOrAdd whose factory captures an argument', async () => {
      const src = `
using System.Collections.Concurrent;
class C { int M(ConcurrentDictionary<int, int> d, int seed) { return d.GetOrAdd(1, k => k + seed); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag GetOrAdd whose factory uses only the key', async () => {
      const src = `
using System.Collections.Concurrent;
class C { int M(ConcurrentDictionary<int, int> d) { return d.GetOrAdd(1, k => k + 1); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
    it('does not flag the state-parameter overload', async () => {
      const src = `
using System.Collections.Concurrent;
class C { int M(ConcurrentDictionary<int, int> d, int seed) { return d.GetOrAdd(1, (k, s) => k + s, seed); } }`
      expect(await keys(src, K)).not.toContain(K)
    })
  })

  // ---- uncached-searchvalues ---------------------------------------------
  describe('uncached-searchvalues', () => {
    const K = 'performance/deterministic/uncached-searchvalues'
    it('flags IndexOfAny with an inline string literal', async () => {
      const src = `
using System;
class C { int M(ReadOnlySpan<char> s) { return s.IndexOfAny("abc"); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('flags string.IndexOfAny with an inline char array', async () => {
      const src = `
class C { int M(string s) { return s.IndexOfAny(new[] { 'a', 'b' }); } }`
      expect(await keys(src, K)).toContain(K)
    })
    it('does not flag a hoisted SearchValues argument', async () => {
      const src = `
using System;
using System.Buffers;
class C {
  static readonly SearchValues<char> Vowels = SearchValues.Create("aeiou");
  int M(ReadOnlySpan<char> s) => s.IndexOfAny(Vowels);
}`
      expect(await keys(src, K)).not.toContain(K)
    })
  })
})
