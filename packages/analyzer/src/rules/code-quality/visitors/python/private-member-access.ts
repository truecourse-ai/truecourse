import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('web-tree-sitter').Node

// Members on `namedtuple` / `urllib.parse.ParseResult`-style
// stdlib types that are intentionally underscore-prefixed
// (Python's collections.namedtuple uses `_` to avoid colliding
// with field names). These are public API.
const NAMEDTUPLE_PUBLIC_MEMBERS = new Set([
  '_make', '_replace', '_asdict', '_fields', '_field_defaults', '_source',
])

/**
 * Walk up to the nearest enclosing class_definition. Returns
 * the class name, or null if not inside a class.
 */
function findEnclosingClassName(node: SyntaxNode): string | null {
  let cursor: SyntaxNode | null = node.parent
  while (cursor) {
    if (cursor.type === 'class_definition') {
      const name = cursor.childForFieldName('name')
      return name?.text ?? null
    }
    cursor = cursor.parent
  }
  return null
}

export const pythonPrivateMemberAccessVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/private-member-access',
  languages: ['python'],
  nodeTypes: ['attribute'],
  visit(node, filePath, sourceCode) {
    const attr = node.childForFieldName('attribute')
    if (!attr) return null
    const attrName = attr.text
    if (!attrName.startsWith('_') || attrName.startsWith('__')) return null

    const obj = node.childForFieldName('object')
    if (!obj) return null

    // Skip self._attr and cls._attr — those are internal access
    if (obj.type === 'identifier' && (obj.text === 'self' || obj.text === 'cls')) return null

    // Skip namedtuple stdlib API: `_replace`, `_asdict`, etc.
    // are intentionally underscore-prefixed in Python's
    // collections.namedtuple (to avoid colliding with field
    // names). These are documented public methods.
    if (NAMEDTUPLE_PUBLIC_MEMBERS.has(attrName)) return null

    // Skip when the receiver is the same class identifier as
    // the enclosing class — `JiraFactory._method(...)` called
    // from inside `class JiraFactory:`. Same-class private
    // access is internal, even when written as `Class._x` for
    // a `@staticmethod` / `@classmethod` call site.
    if (obj.type === 'identifier') {
      const enclosingClassName = findEnclosingClassName(node)
      if (enclosingClassName && enclosingClassName === obj.text) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'External access to private member',
      `Accessing \`${obj.text}.${attrName}\` — names starting with \`_\` are private and not part of the public API.`,
      sourceCode,
      'Use the public API instead of accessing private members.',
    )
  },
}
