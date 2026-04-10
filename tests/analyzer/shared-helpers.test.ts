/**
 * Unit tests for `_shared/javascript-helpers.ts`.
 *
 * These helpers are intentionally tested in isolation BEFORE any visitor uses
 * them — see docs/BATTLE-TEST-CYCLE.md (the fileAnalyses bug from April 2026
 * would have been caught by this kind of in-isolation helper test).
 */
import { describe, it, expect } from 'vitest'
import { parseCode } from '../../packages/analyzer/src/parser'
import {
  containsJsx,
  containsIdentifierExact,
} from '../../packages/analyzer/src/rules/_shared/javascript-helpers'
import type { SyntaxNode } from 'tree-sitter'

function rootNode(code: string, language: 'typescript' | 'tsx' | 'javascript' = 'typescript'): SyntaxNode {
  return parseCode(code, language).rootNode
}

// ---------------------------------------------------------------------------
// containsJsx
// ---------------------------------------------------------------------------

describe('containsJsx', () => {
  it('returns true for a self-closing JSX element', () => {
    const root = rootNode(`const x = <Foo />;`, 'tsx')
    expect(containsJsx(root)).toBe(true)
  })

  it('returns true for a JSX element with children', () => {
    const root = rootNode(`const x = <div><span>hi</span></div>;`, 'tsx')
    expect(containsJsx(root)).toBe(true)
  })

  it('returns true for a JSX fragment', () => {
    const root = rootNode(`const x = <><Foo /><Bar /></>;`, 'tsx')
    expect(containsJsx(root)).toBe(true)
  })

  it('returns true when JSX is nested inside a function body', () => {
    const code = `
      function App() {
        return <div>hello</div>;
      }
    `
    expect(containsJsx(rootNode(code, 'tsx'))).toBe(true)
  })

  it('returns true when JSX is inside a conditional expression', () => {
    const code = `
      function App({ visible }: { visible: boolean }) {
        return visible ? <div>shown</div> : null;
      }
    `
    expect(containsJsx(rootNode(code, 'tsx'))).toBe(true)
  })

  // ---- The cases that broke text.includes('<') ----

  it('returns false for TypeScript generics like Array<T>', () => {
    const code = `function first<T>(arr: Array<T>): T { return arr[0]; }`
    expect(containsJsx(rootNode(code))).toBe(false)
  })

  it('returns false for nested generics like Map<K, V>', () => {
    const code = `function makeMap<K, V>(): Map<K, V> { return new Map<K, V>(); }`
    expect(containsJsx(rootNode(code))).toBe(false)
  })

  it('returns false for comparison operators', () => {
    const code = `function compare(a: number, b: number): number { return a > b ? 1 : a < b ? -1 : 0; }`
    expect(containsJsx(rootNode(code))).toBe(false)
  })

  it('returns false for combined generics and comparisons', () => {
    const code = `
      function clamp<T extends number>(val: T, min: T, max: T): T {
        return val < min ? min : val > max ? max : val;
      }
    `
    expect(containsJsx(rootNode(code))).toBe(false)
  })

  it('returns false for angle brackets inside string literals', () => {
    const code = `const html = "<div>not jsx</div>";`
    expect(containsJsx(rootNode(code))).toBe(false)
  })

  it('returns false for arrow function syntax (=>)', () => {
    const code = `const fn = (x: number) => x + 1;`
    expect(containsJsx(rootNode(code))).toBe(false)
  })

  it('returns false for an empty file', () => {
    expect(containsJsx(rootNode(``))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// containsIdentifierExact
// ---------------------------------------------------------------------------

describe('containsIdentifierExact', () => {
  it('returns true when the identifier appears as a bare reference', () => {
    const root = rootNode(`const x = foo;`)
    expect(containsIdentifierExact(root, 'foo')).toBe(true)
  })

  it('returns true when the identifier appears as a call callee', () => {
    const root = rootNode(`bar();`)
    expect(containsIdentifierExact(root, 'bar')).toBe(true)
  })

  it('returns true when the identifier appears as a member expression object', () => {
    const root = rootNode(`obj.prop = 1;`)
    expect(containsIdentifierExact(root, 'obj')).toBe(true)
  })

  it('returns true for identifiers nested deep in expressions', () => {
    const root = rootNode(`const x = a + (b * (c - foo));`)
    expect(containsIdentifierExact(root, 'foo')).toBe(true)
  })

  // ---- The cases that broke text.includes(name) ----

  it('returns false for substring collisions (id vs getId)', () => {
    const root = rootNode(`function getId() { return 1; }`)
    expect(containsIdentifierExact(root, 'id')).toBe(false)
  })

  it('returns false for substring collisions (body vs bodyParser)', () => {
    const root = rootNode(`const bodyParser = require('body-parser');`)
    expect(containsIdentifierExact(root, 'body')).toBe(false)
  })

  it('returns false for substring collisions (req vs request)', () => {
    const root = rootNode(`const request = makeRequest();`)
    expect(containsIdentifierExact(root, 'req')).toBe(false)
  })

  it('returns false when the name only appears inside a string literal', () => {
    const root = rootNode(`const msg = "foo bar";`)
    expect(containsIdentifierExact(root, 'foo')).toBe(false)
  })

  it('returns false when the name only appears inside a comment', () => {
    const root = rootNode(`// uses foo somewhere\nconst x = 1;`)
    expect(containsIdentifierExact(root, 'foo')).toBe(false)
  })

  it('returns false for member access property (only object is an identifier)', () => {
    // For `a.b`, `b` is a property_identifier, not an identifier — by design.
    const root = rootNode(`const x = a.b;`)
    expect(containsIdentifierExact(root, 'a')).toBe(true)
    expect(containsIdentifierExact(root, 'b')).toBe(false)
  })

  it('returns false for an empty file', () => {
    expect(containsIdentifierExact(rootNode(``), 'anything')).toBe(false)
  })
})
