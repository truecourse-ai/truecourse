/**
 * Shared JavaScript/TypeScript AST helpers for visitors across all rule domains.
 *
 * Helpers in this file are language-level utilities — they don't carry domain
 * knowledge (no "is route handler", no "is ORM call"). Domain-specific helpers
 * still live in each domain's `_helpers.ts`.
 *
 * The goal of this file is to replace fragile text-grep patterns
 * (`text.includes('<')`, `arg.includes(name)`) with proper AST checks that
 * don't leak across substrings, comments, or string literals.
 */
import type { SyntaxNode } from 'tree-sitter'

/**
 * Tree-sitter node types that represent JSX syntax in TypeScript and JavaScript.
 */
const JSX_NODE_TYPES = new Set([
  'jsx_element',
  'jsx_self_closing_element',
  'jsx_fragment',
  'jsx_expression',
  'jsx_opening_element',
  'jsx_closing_element',
  'jsx_attribute',
])

/**
 * Returns true if `node` itself or any descendant is a JSX element/fragment.
 *
 * Use this instead of textual checks like `text.includes('<')` or
 * `/<[A-Z]/.test(text)`, which match TypeScript generics (`Array<T>`),
 * comparison operators (`a < b`), and angle brackets in comments/strings.
 */
export function containsJsx(node: SyntaxNode): boolean {
  if (JSX_NODE_TYPES.has(node.type)) return true
  for (const child of node.namedChildren) {
    if (containsJsx(child)) return true
  }
  return false
}

/**
 * Returns true if `node` itself or any descendant is an `identifier` whose
 * text exactly equals `name`.
 *
 * Use this instead of `node.text.includes(name)`, which leaks across
 * substrings (`name = "id"` matches `getId`, `valid`, `paid`, etc.) and
 * matches identifiers inside comments and string literals.
 */
export function containsIdentifierExact(node: SyntaxNode, name: string): boolean {
  if (node.type === 'identifier' && node.text === name) return true
  for (const child of node.namedChildren) {
    if (containsIdentifierExact(child, name)) return true
  }
  return false
}
