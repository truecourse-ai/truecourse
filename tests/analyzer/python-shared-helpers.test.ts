/**
 * Unit tests for `_shared/python-helpers.ts`.
 *
 * Tested in isolation BEFORE any visitor uses them — same pattern as the JS
 * helpers in `tests/analyzer/shared-helpers.test.ts`.
 */
import { describe, it, expect } from 'vitest'
import { parseCode } from '../../packages/analyzer/src/parser'
import {
  containsPythonIdentifierExact,
  containsPythonCallTo,
  getEnclosingPythonFunction,
  isInsidePythonTypeAnnotation,
  getPythonDecoratorName,
  getPythonModuleNode,
} from '../../packages/analyzer/src/rules/_shared/python-helpers'
import type { SyntaxNode } from 'tree-sitter'

function rootNode(code: string): SyntaxNode {
  return parseCode(code, 'python').rootNode
}

/** Find the first descendant matching the given type. */
function firstNodeOfType(root: SyntaxNode, type: string): SyntaxNode | null {
  if (root.type === type) return root
  for (const child of root.namedChildren) {
    const found = firstNodeOfType(child, type)
    if (found) return found
  }
  return null
}

/** Find the first identifier with the given text. */
function firstIdentifier(root: SyntaxNode, text: string): SyntaxNode | null {
  if (root.type === 'identifier' && root.text === text) return root
  for (const child of root.namedChildren) {
    const found = firstIdentifier(child, text)
    if (found) return found
  }
  return null
}

// ---------------------------------------------------------------------------
// containsPythonIdentifierExact
// ---------------------------------------------------------------------------

describe('containsPythonIdentifierExact', () => {
  it('returns true when the identifier appears as a bare reference', () => {
    expect(containsPythonIdentifierExact(rootNode(`x = foo`), 'foo')).toBe(true)
  })

  it('returns true when the identifier appears as a call callee', () => {
    expect(containsPythonIdentifierExact(rootNode(`bar()`), 'bar')).toBe(true)
  })

  it('returns true when the identifier appears as the object of an attribute', () => {
    expect(containsPythonIdentifierExact(rootNode(`obj.prop = 1`), 'obj')).toBe(true)
  })

  it('returns true for identifiers nested deep in expressions', () => {
    expect(containsPythonIdentifierExact(rootNode(`x = a + (b * (c - foo))`), 'foo')).toBe(true)
  })

  // ---- The cases that broke text.includes(name) ----

  it('returns false for substring collisions (id vs get_id)', () => {
    expect(containsPythonIdentifierExact(rootNode(`def get_id():\n    return 1`), 'id')).toBe(false)
  })

  it('returns false for substring collisions (body vs body_parser)', () => {
    expect(containsPythonIdentifierExact(rootNode(`body_parser = make()`), 'body')).toBe(false)
  })

  it('returns false for substring collisions (req vs request)', () => {
    expect(containsPythonIdentifierExact(rootNode(`request = make()`), 'req')).toBe(false)
  })

  it('returns false when the name only appears inside a string literal', () => {
    expect(containsPythonIdentifierExact(rootNode(`msg = "foo bar"`), 'foo')).toBe(false)
  })

  it('returns false when the name only appears inside a comment', () => {
    expect(containsPythonIdentifierExact(rootNode(`# uses foo somewhere\nx = 1`), 'foo')).toBe(false)
  })

  it('returns true for object identifier in attribute, false for attribute name', () => {
    // For `a.b`, `a` is an identifier but `b` is not (it's accessed as the
    // 'attribute' field — also an identifier in tree-sitter Python). Both will
    // match — verify the helper doesn't make spurious distinctions.
    const root = rootNode(`x = a.b`)
    expect(containsPythonIdentifierExact(root, 'a')).toBe(true)
    expect(containsPythonIdentifierExact(root, 'b')).toBe(true)
  })

  it('returns false for an empty file', () => {
    expect(containsPythonIdentifierExact(rootNode(``), 'anything')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// containsPythonCallTo
// ---------------------------------------------------------------------------

describe('containsPythonCallTo', () => {
  it('detects a top-level bare call', () => {
    expect(containsPythonCallTo(rootNode(`foo()`), 'foo')).toBe(true)
  })

  it('detects a nested attribute call', () => {
    expect(containsPythonCallTo(rootNode(`x = obj.method(1, 2)`), 'obj.method')).toBe(true)
  })

  it('detects a deeply nested call', () => {
    const code = `
def f():
    if cond:
        x = some_helper(1, 2)
`
    expect(containsPythonCallTo(rootNode(code), 'some_helper')).toBe(true)
  })

  it('returns false for a different callee name', () => {
    expect(containsPythonCallTo(rootNode(`bar()`), 'foo')).toBe(false)
  })

  it('returns false when the callee text is only part of an attribute', () => {
    // Looking for `foo`, but the call is `foo.bar()` — the function field
    // text is `foo.bar`, not `foo`.
    expect(containsPythonCallTo(rootNode(`foo.bar()`), 'foo')).toBe(false)
  })

  it('returns false when name only appears in a string literal', () => {
    expect(containsPythonCallTo(rootNode(`msg = "foo()"`), 'foo')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getEnclosingPythonFunction
// ---------------------------------------------------------------------------

describe('getEnclosingPythonFunction', () => {
  it('returns the enclosing function for a body statement', () => {
    const root = rootNode(`
def foo():
    x = bar()
`)
    const inner = firstIdentifier(root, 'bar')!
    const fn = getEnclosingPythonFunction(inner)
    expect(fn).not.toBeNull()
    expect(fn?.type).toBe('function_definition')
    expect(fn?.childForFieldName('name')?.text).toBe('foo')
  })

  it('returns the inner function for a nested function body', () => {
    const root = rootNode(`
def outer():
    def inner():
        x = bar()
    return inner
`)
    const inner = firstIdentifier(root, 'bar')!
    const fn = getEnclosingPythonFunction(inner)
    expect(fn?.childForFieldName('name')?.text).toBe('inner')
  })

  it('returns the method for a method body', () => {
    const root = rootNode(`
class C:
    def m(self):
        x = bar()
`)
    const inner = firstIdentifier(root, 'bar')!
    const fn = getEnclosingPythonFunction(inner)
    expect(fn?.childForFieldName('name')?.text).toBe('m')
  })

  it('returns null at module level', () => {
    const root = rootNode(`x = bar()`)
    const inner = firstIdentifier(root, 'bar')!
    expect(getEnclosingPythonFunction(inner)).toBeNull()
  })

  it('does NOT count lambdas as functions', () => {
    // A lambda is not a function_definition, so the enclosing function
    // should be the *outer* def, not the lambda.
    const root = rootNode(`
def outer():
    f = lambda x: x + bar()
`)
    const inner = firstIdentifier(root, 'bar')!
    const fn = getEnclosingPythonFunction(inner)
    expect(fn?.childForFieldName('name')?.text).toBe('outer')
  })
})

// ---------------------------------------------------------------------------
// isInsidePythonTypeAnnotation
// ---------------------------------------------------------------------------

describe('isInsidePythonTypeAnnotation', () => {
  it('returns true for a parameter type annotation', () => {
    const root = rootNode(`def f(x: int): pass`)
    const intIdent = firstIdentifier(root, 'int')!
    expect(isInsidePythonTypeAnnotation(intIdent)).toBe(true)
  })

  it('returns true for a return type annotation', () => {
    const root = rootNode(`def f() -> str: pass`)
    const strIdent = firstIdentifier(root, 'str')!
    expect(isInsidePythonTypeAnnotation(strIdent)).toBe(true)
  })

  it('returns true for a variable annotation', () => {
    const root = rootNode(`x: int = 1`)
    const intIdent = firstIdentifier(root, 'int')!
    expect(isInsidePythonTypeAnnotation(intIdent)).toBe(true)
  })

  it('returns true for a generic type argument', () => {
    const root = rootNode(`x: List[int] = []`)
    const intIdent = firstIdentifier(root, 'int')!
    expect(isInsidePythonTypeAnnotation(intIdent)).toBe(true)
  })

  it('returns true for a nested generic type argument', () => {
    const root = rootNode(`x: Dict[str, List[int]] = {}`)
    const intIdent = firstIdentifier(root, 'int')!
    expect(isInsidePythonTypeAnnotation(intIdent)).toBe(true)
  })

  it('returns false for an identifier in an expression', () => {
    const root = rootNode(`x = foo + bar`)
    const fooIdent = firstIdentifier(root, 'foo')!
    expect(isInsidePythonTypeAnnotation(fooIdent)).toBe(false)
  })

  it('returns false for a function body identifier', () => {
    const root = rootNode(`
def f(x: int) -> str:
    return foo(x)
`)
    const fooIdent = firstIdentifier(root, 'foo')!
    expect(isInsidePythonTypeAnnotation(fooIdent)).toBe(false)
  })

  it('returns false for a default value expression', () => {
    // The `5` in `x: int = 5` is the value, NOT in a type annotation.
    const root = rootNode(`x: int = 5`)
    // Find the `5` integer node
    const five = firstNodeOfType(root, 'integer')!
    expect(isInsidePythonTypeAnnotation(five)).toBe(false)
  })

  it('returns false at module level', () => {
    const root = rootNode(`x = 1`)
    expect(isInsidePythonTypeAnnotation(root)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getPythonDecoratorName
// ---------------------------------------------------------------------------

describe('getPythonDecoratorName', () => {
  function decoratorFromCode(code: string): SyntaxNode {
    return firstNodeOfType(rootNode(code), 'decorator')!
  }

  it('returns the bare identifier for @foo', () => {
    expect(getPythonDecoratorName(decoratorFromCode(`@foo\ndef f(): pass`))).toBe('foo')
  })

  it('returns the identifier for @foo()', () => {
    expect(getPythonDecoratorName(decoratorFromCode(`@foo()\ndef f(): pass`))).toBe('foo')
  })

  it('returns the terminal name for @foo.bar', () => {
    expect(getPythonDecoratorName(decoratorFromCode(`@foo.bar\ndef f(): pass`))).toBe('bar')
  })

  it('returns the terminal name for @foo.bar()', () => {
    expect(getPythonDecoratorName(decoratorFromCode(`@foo.bar()\ndef f(): pass`))).toBe('bar')
  })

  it('returns the terminal name for @app.route(\'/path\')', () => {
    expect(getPythonDecoratorName(decoratorFromCode(`@app.route('/path')\ndef f(): pass`))).toBe('route')
  })

  it('returns the terminal name for @pytest.mark.parametrize', () => {
    expect(getPythonDecoratorName(decoratorFromCode(`@pytest.mark.parametrize('x', [1])\ndef f(x): pass`))).toBe('parametrize')
  })

  it('returns the terminal name for @a.b.c.d', () => {
    expect(getPythonDecoratorName(decoratorFromCode(`@a.b.c.d\ndef f(): pass`))).toBe('d')
  })

  it('returns null for a non-decorator node', () => {
    const root = rootNode(`x = 1`)
    const id = firstIdentifier(root, 'x')!
    expect(getPythonDecoratorName(id)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getPythonModuleNode
// ---------------------------------------------------------------------------

describe('getPythonModuleNode', () => {
  it('returns the same module for any descendant', () => {
    const root = rootNode(`
def foo():
    x = bar()
`)
    const bar = firstIdentifier(root, 'bar')!
    const m = getPythonModuleNode(bar)
    expect(m.type).toBe('module')
    expect(m.id).toBe(root.id)
  })

  it('returns the module itself when called on the root', () => {
    const root = rootNode(`x = 1`)
    expect(getPythonModuleNode(root).id).toBe(root.id)
  })
})
