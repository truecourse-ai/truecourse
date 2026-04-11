/**
 * Shared Python AST helpers for visitors across all rule domains.
 *
 * Helpers in this file are language-level utilities — they don't carry domain
 * knowledge (no "is route handler", no "is ORM call"). Domain-specific helpers
 * still live in each domain's `_helpers.ts`.
 *
 * The goal of this file is to replace fragile text-grep patterns
 * (`text.includes('request.')`, `arg.includes(name)`) with proper AST checks
 * that don't leak across substrings, comments, or string literals.
 *
 * Mirrors the shape of `_shared/javascript-helpers.ts` — see that file for
 * the JS equivalents.
 */
import type { SyntaxNode } from 'tree-sitter'

/**
 * Returns true if `node` itself or any descendant is an `identifier` whose
 * text exactly equals `name`.
 *
 * Use this instead of `node.text.includes(name)`, which leaks across
 * substrings (`name = "id"` matches `getId`, `valid`, `paid`, etc.) and
 * matches identifiers inside comments and string literals.
 */
export function containsPythonIdentifierExact(node: SyntaxNode, name: string): boolean {
  if (node.type === 'identifier' && node.text === name) return true
  for (const child of node.namedChildren) {
    if (containsPythonIdentifierExact(child, name)) return true
  }
  return false
}

/**
 * Returns true if `node` itself or any descendant is a `call` expression whose
 * `function` field's text equals `calleeText`.
 *
 * For attribute callees (e.g. `obj.method()`), `calleeText` should be the full
 * attribute text (`"obj.method"`). For bare callees, just the identifier
 * (`"foo"`).
 */
export function containsPythonCallTo(node: SyntaxNode, calleeText: string): boolean {
  if (node.type === 'call') {
    const fn = node.childForFieldName('function')
    if (fn?.text === calleeText) return true
  }
  for (const child of node.namedChildren) {
    if (containsPythonCallTo(child, calleeText)) return true
  }
  return false
}

/**
 * Walks up to find the enclosing `function_definition`. Returns null if at
 * module level. Stops at module boundary; class definitions are crossed
 * (a method inside a class is still inside its surrounding function if any).
 *
 * Lambdas are NOT considered functions for this helper — most rules that
 * call this want the def-level function, not anonymous lambda scope.
 */
export function getEnclosingPythonFunction(node: SyntaxNode): SyntaxNode | null {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'function_definition') return current
    current = current.parent
  }
  return null
}

/**
 * True if `node` is in a type-annotation position.
 *
 * Tree-sitter Python wraps type annotations in a `type` node:
 *   - parameter:        `typed_parameter` / `typed_default_parameter`'s `type` field
 *   - return type:      `function_definition`'s `return_type` field (a `type` node)
 *   - variable:         `assignment`'s `type` field
 *   - generic args:     `type_parameter` and `generic_type` wrapping `type` nodes
 *
 * Walking up from a node in any of these positions will hit a `type`,
 * `generic_type`, `type_parameter`, or `union_type` ancestor before hitting
 * the enclosing `function_definition`/`class_definition`/`module`.
 *
 * Used by rules like `undefined-name` to skip references that only exist as
 * type hints (which may be forward refs or import-only symbols).
 */
export function isInsidePythonTypeAnnotation(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (
      current.type === 'type' ||
      current.type === 'generic_type' ||
      current.type === 'type_parameter' ||
      current.type === 'union_type' ||
      current.type === 'constrained_type' ||
      current.type === 'member_type' ||
      current.type === 'splat_type'
    ) {
      return true
    }
    // Stop at body boundaries — annotations don't appear inside bodies/blocks
    if (
      current.type === 'block' ||
      current.type === 'function_definition' ||
      current.type === 'class_definition' ||
      current.type === 'module'
    ) {
      return false
    }
    current = current.parent
  }
  return false
}

/**
 * Extract a decorator's terminal name. Handles all common forms:
 *   @foo                       → 'foo'
 *   @foo()                     → 'foo'
 *   @foo.bar                   → 'bar'
 *   @foo.bar()                 → 'bar'
 *   @app.route('/path')        → 'route'
 *   @pytest.mark.parametrize   → 'parametrize'
 *   @a.b.c.d                   → 'd'
 *
 * Returns null if the decorator doesn't have a recognizable shape (which
 * shouldn't happen for valid Python but defends against parse errors).
 *
 * `decoratorNode` should be a `decorator` AST node.
 */
export function getPythonDecoratorName(decoratorNode: SyntaxNode): string | null {
  if (decoratorNode.type !== 'decorator') return null
  // The decorator has a single named child: identifier, attribute, or call.
  const inner = decoratorNode.namedChildren[0]
  if (!inner) return null
  return extractTerminalName(inner)
}

/** Recursively extract the terminal identifier from an attribute/call/identifier chain. */
function extractTerminalName(node: SyntaxNode): string | null {
  if (node.type === 'identifier') return node.text
  if (node.type === 'attribute') {
    const attr = node.childForFieldName('attribute')
    return attr?.text ?? null
  }
  if (node.type === 'call') {
    const fn = node.childForFieldName('function')
    if (fn) return extractTerminalName(fn)
  }
  return null
}

/**
 * Walk up to find the `module` (program root) node. Used by the framework-
 * detection cache to key the WeakMap.
 */
export function getPythonModuleNode(node: SyntaxNode): SyntaxNode {
  let current: SyntaxNode = node
  while (current.parent) current = current.parent
  return current
}
