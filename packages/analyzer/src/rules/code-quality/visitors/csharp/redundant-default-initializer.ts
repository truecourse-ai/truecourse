import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'
import { getCSharpDeclAttributeNames, isCSharpGeneratedSource } from './_helpers.js'

/** Numeric types whose default value is the literal `0`. */
const NUMERIC_TYPES = new Set([
  'int', 'long', 'short', 'byte', 'sbyte', 'uint', 'ulong', 'ushort',
  'float', 'double', 'decimal', 'nint', 'nuint',
])

/** True when `value` is the explicit default of a field of `typeText`. */
function isExplicitDefault(typeNode: SyntaxNode | null, value: SyntaxNode): boolean {
  // `= default` / `= default(T)` is the default for any type.
  if (value.type === 'default_expression') return true

  const typeText = typeNode?.text ?? ''
  if (value.type === 'null_literal') {
    // Reference and nullable-value types default to null.
    return typeNode?.type !== 'predefined_type' || !NUMERIC_TYPES.has(typeText)
  }
  if (value.type === 'boolean_literal') {
    return typeText === 'bool' && value.text === 'false'
  }
  if (value.type === 'integer_literal') {
    if (!NUMERIC_TYPES.has(typeText)) return false
    return Number(value.text.replace(/_/g, '').replace(/[ul]+$/i, '')) === 0
  }
  if (value.type === 'real_literal') {
    if (!NUMERIC_TYPES.has(typeText)) return false
    return Number(value.text.replace(/[fdm]+$/i, '')) === 0
  }
  return false
}

/**
 * A field initialized to its type's default — `int x = 0;`, `string s = null;`,
 * `bool b = false;`, `T t = default;` — restates what the runtime already
 * guarantees for unassigned fields; the initializer is noise (S3052/CA1805).
 * `const` fields require an initializer and are exempt. Attribute-decorated
 * fields are left alone (a serializer may treat "explicitly set" specially).
 */
export const csharpRedundantDefaultInitializerVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-default-initializer',
  languages: ['csharp'],
  nodeTypes: ['field_declaration'],
  visit(node, filePath, sourceCode) {
    if (isCSharpGeneratedSource(filePath, sourceCode)) return null
    if (hasCSharpModifier(node, 'const')) return null
    if (getCSharpDeclAttributeNames(node).length > 0) return null

    const varDecl = node.namedChildren.find((c) => c?.type === 'variable_declaration')
    if (!varDecl) return null
    const typeNode = varDecl.childForFieldName('type')

    for (const declarator of varDecl.namedChildren) {
      if (declarator?.type !== 'variable_declarator') continue
      const nameNode = declarator.childForFieldName('name')
      const value = declarator.namedChildren.find((c) => c != null && c.id !== nameNode?.id)
      if (!value) continue
      if (!isExplicitDefault(typeNode, value)) continue

      const name = nameNode?.text ?? 'field'
      return makeViolation(
        this.ruleKey, value, filePath, 'low',
        'Field explicitly initialized to default',
        `Field \`${name}\` is explicitly initialized to its type's default — the runtime already guarantees this, so the initializer is redundant (S3052/CA1805).`,
        sourceCode,
        'Remove the redundant default initializer.',
      )
    }
    return null
  },
}
