import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

/** Primitive types whose `const` values are compile-time constants. */
const CONST_ELIGIBLE_PREDEFINED = new Set([
  'int', 'long', 'short', 'byte', 'sbyte', 'uint', 'ulong', 'ushort',
  'float', 'double', 'decimal', 'bool', 'char', 'string',
])

/** A literal whose value is known at compile time (so `const`-assignable). */
function isCompileTimeConstantLiteral(node: SyntaxNode | null | undefined): boolean {
  if (!node) return false
  switch (node.type) {
    case 'integer_literal':
    case 'real_literal':
    case 'boolean_literal':
    case 'character_literal':
    case 'string_literal':
      return true
    case 'prefix_unary_expression':
      // `-1`, `+2` over a numeric literal.
      return isCompileTimeConstantLiteral(node.namedChildren.find((c) => c != null))
    default:
      return false
  }
}

/**
 * A `static readonly` field of a primitive type initialized to a literal is a
 * compile-time constant in disguise — `const` is inlined at the call site,
 * skips a static-field read, and documents the value as fixed (CA1802).
 * Restricted to predefined primitive types with a literal initializer so we
 * never recommend `const` for a reference type (a `static readonly` array,
 * say, cannot be `const`).
 */
export const csharpStaticReadonlyShouldBeConstVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/static-readonly-should-be-const',
  languages: ['csharp'],
  nodeTypes: ['field_declaration'],
  visit(node, filePath, sourceCode) {
    if (!hasCSharpModifier(node, 'static') || !hasCSharpModifier(node, 'readonly')) return null
    if (hasCSharpModifier(node, 'volatile')) return null

    const varDecl = node.namedChildren.find((c) => c?.type === 'variable_declaration')
    if (!varDecl) return null

    const typeNode = varDecl.childForFieldName('type') ?? varDecl.namedChildren[0]
    if (!typeNode || typeNode.type !== 'predefined_type') return null
    if (!CONST_ELIGIBLE_PREDEFINED.has(typeNode.text)) return null

    const declarators = varDecl.namedChildren.filter((c) => c?.type === 'variable_declarator')
    if (declarators.length === 0) return null

    // Every declarator must have a compile-time-constant literal initializer.
    let firstName: SyntaxNode | null = null
    for (const declarator of declarators) {
      if (!declarator) return null
      const nameNode = declarator.childForFieldName('name')
      const value = declarator.namedChildren.find((c) => c != null && c.id !== nameNode?.id)
      if (!isCompileTimeConstantLiteral(value)) return null
      if (!firstName) firstName = nameNode ?? declarator
    }

    return makeViolation(
      this.ruleKey, firstName ?? node, filePath, 'low',
      'static readonly should be const',
      'A `static readonly` primitive initialized to a literal is a compile-time constant — declare it `const` so the value is inlined and the field read is skipped (CA1802).',
      sourceCode,
      'Change `static readonly` to `const`.',
    )
  },
}
