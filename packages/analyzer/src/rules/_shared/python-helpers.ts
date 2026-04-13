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

// ---------------------------------------------------------------------------
// Script-like file detection (shared — replaces 5+ inline implementations)
// ---------------------------------------------------------------------------

/** Per-module cache for the __main__ guard check. */
const scriptLikeCache = new WeakMap<SyntaxNode, boolean>()

/**
 * True if the file is a script / CLI tool / entry point.
 *
 * A file is considered script-like if:
 *   1. Its basename is `__main__.py` or `manage.py`, OR
 *   2. It contains a top-level `if __name__ == "__main__":` guard, OR
 *   3. Its immediate parent directory is `scripts`, `bin`, `tools`, `cli`, or `cmd`.
 *
 * Print / sys.exit / root-logger calls in script-like files are legitimate.
 */
export function isScriptLikeFile(node: SyntaxNode, filePath: string): boolean {
  const segments = filePath.split('/')
  const fileName = segments[segments.length - 1]?.toLowerCase() ?? ''
  const dirName = segments[segments.length - 2]?.toLowerCase() ?? ''

  // Basename check
  if (fileName === '__main__.py' || fileName === 'manage.py') return true

  // Directory check
  if (dirName === 'scripts' || dirName === 'bin' || dirName === 'tools' ||
      dirName === 'cli' || dirName === 'cmd') return true

  // AST check: top-level `if __name__ == "__main__":`
  const module = getPythonModuleNode(node)
  const cached = scriptLikeCache.get(module)
  if (cached !== undefined) return cached

  let found = false
  for (const child of module.namedChildren) {
    if (child.type === 'if_statement') {
      const condition = child.childForFieldName('condition')
      if (condition && isDunderMainComparison(condition)) {
        found = true
        break
      }
    }
  }
  scriptLikeCache.set(module, found)
  return found
}

/** Matches `__name__ == "__main__"` or `"__main__" == __name__`. */
function isDunderMainComparison(n: SyntaxNode): boolean {
  if (n.type !== 'comparison_operator') return false
  const first = n.namedChildren[0]
  const second = n.namedChildren[1]
  if (!first || !second) return false

  const isNameIdent = (node: SyntaxNode) =>
    node.type === 'identifier' && node.text === '__name__'
  const isMainString = (node: SyntaxNode) => {
    if (node.type !== 'string') return false
    const stripped = node.text.replace(/^['"]|['"]$/g, '')
    return stripped === '__main__'
  }

  return (isNameIdent(first) && isMainString(second)) || (isMainString(first) && isNameIdent(second))
}

// ---------------------------------------------------------------------------
// Test file detection (shared — replaces 3+ inline implementations)
// ---------------------------------------------------------------------------

/**
 * True if the file is a Python test file. Checks the basename and immediate
 * directory — NOT the full path (to avoid matching `latest_config.py` in a
 * directory whose parent is `test-data`).
 *
 * Matches:
 *   - `test_*.py` (pytest naming convention)
 *   - `*_test.py` (alternative convention)
 *   - `conftest.py` (pytest configuration)
 *   - Files in `test/`, `tests/`, or `__tests__/` directories
 */
export function isPythonTestFile(filePath: string): boolean {
  const segments = filePath.split('/')
  const fileName = segments[segments.length - 1]?.toLowerCase() ?? ''
  const dirName = segments[segments.length - 2]?.toLowerCase() ?? ''

  if (
    fileName.startsWith('test_') ||
    fileName.endsWith('_test.py') ||
    fileName === 'conftest.py'
  ) return true

  if (dirName === 'test' || dirName === 'tests' || dirName === '__tests__') return true

  return false
}

// ---------------------------------------------------------------------------
// Decorator helpers (shared — replaces 8+ `.text.includes()` patterns)
// ---------------------------------------------------------------------------

/**
 * Returns the full dotted name of a decorator, excluding arguments.
 *   @foo                       → 'foo'
 *   @foo()                     → 'foo'
 *   @foo.bar                   → 'foo.bar'
 *   @foo.bar()                 → 'foo.bar'
 *   @app.route('/path')        → 'app.route'
 *   @pytest.mark.parametrize   → 'pytest.mark.parametrize'
 *
 * Returns null if the decorator doesn't have a recognizable shape.
 */
export function getPythonDecoratorFullName(decoratorNode: SyntaxNode): string | null {
  if (decoratorNode.type !== 'decorator') return null
  const inner = decoratorNode.namedChildren[0]
  if (!inner) return null
  return extractFullDottedName(inner)
}

function extractFullDottedName(node: SyntaxNode): string | null {
  if (node.type === 'identifier') return node.text
  if (node.type === 'attribute') return node.text.replace(/\s+/g, '')
  if (node.type === 'call') {
    const fn = node.childForFieldName('function')
    if (fn) return extractFullDottedName(fn)
  }
  return null
}

/**
 * True if a `decorated_definition`, `function_definition`, or
 * `class_definition` node has a decorator whose terminal name matches.
 *
 * Replaces fragile patterns like `d.text.includes('dataclass')` which
 * match substring occurrences in arguments and comments.
 */
export function hasDecoratorNamed(node: SyntaxNode, terminalName: string): boolean {
  const decorators = getDecorators(node)
  for (const d of decorators) {
    if (getPythonDecoratorName(d) === terminalName) return true
  }
  return false
}

/**
 * True if a node has a decorator whose full dotted name matches.
 * E.g., `hasDecoratorFullName(node, 'pytest.mark.parametrize')`.
 */
export function hasDecoratorFullName(node: SyntaxNode, fullName: string): boolean {
  const decorators = getDecorators(node)
  for (const d of decorators) {
    if (getPythonDecoratorFullName(d) === fullName) return true
  }
  return false
}

/** Extract decorator nodes from a node. */
function getDecorators(node: SyntaxNode): SyntaxNode[] {
  if (node.type === 'decorated_definition') {
    return node.namedChildren.filter((c) => c.type === 'decorator')
  }
  // For function_definition / class_definition, check if parent is decorated_definition
  if (node.parent?.type === 'decorated_definition') {
    return node.parent.namedChildren.filter((c) => c.type === 'decorator')
  }
  return []
}

// ---------------------------------------------------------------------------
// AST descendant search helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if `node` or any descendant has the given AST node type.
 * Use instead of `body.text.includes('assert')` — which matches comments,
 * strings, and substrings of other identifiers.
 */
export function containsNodeOfType(node: SyntaxNode, type: string): boolean {
  if (node.type === type) return true
  for (const child of node.namedChildren) {
    if (containsNodeOfType(child, type)) return true
  }
  return false
}

/**
 * Returns true if `node` or any descendant contains a subscript access
 * `objectName[indexName]` — e.g., `items[i]`.
 *
 * Use instead of `bodyText.includes('items[i]')` which matches comments
 * and string literals.
 */
export function containsSubscriptAccess(node: SyntaxNode, objectName: string, indexName: string): boolean {
  if (node.type === 'subscript') {
    const obj = node.childForFieldName('value')
    const idx = node.childForFieldName('subscript') ?? node.namedChildren[1]
    if (obj?.text === objectName && idx?.text === indexName) return true
  }
  for (const child of node.namedChildren) {
    if (containsSubscriptAccess(child, objectName, indexName)) return true
  }
  return false
}
