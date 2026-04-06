import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { TypeQueryService } from '../../../../ts-compiler.js'

/**
 * Detects unnecessary namespace qualifiers — referencing Enum.A or
 * Namespace.X from within the Enum/Namespace itself.
 *
 * Example:
 *   enum Foo { A = 1, B = Foo.A }  // Foo.A is unnecessary inside Foo
 *
 * Uses TypeQueryService as a gate but performs AST-based detection:
 * looks for member_expression where the object matches an enclosing
 * enum/namespace declaration name.
 */
export const unnecessaryNamespaceQualifierVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-namespace-qualifier',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['member_expression'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery?: TypeQueryService) {
    if (!typeQuery) return null

    const obj = node.childForFieldName('object')
    const prop = node.childForFieldName('property')
    if (!obj || !prop) return null
    if (obj.type !== 'identifier') return null

    const qualifierName = obj.text

    // Check if we're inside an enum or namespace/module with the same name
    const enclosing = findEnclosingEnumOrNamespace(node, qualifierName)
    if (!enclosing) return null

    return makeViolation(
      this.ruleKey,
      node,
      filePath,
      'low',
      'Unnecessary namespace qualifier',
      `\`${qualifierName}.${prop.text}\` can be simplified to \`${prop.text}\` — you are already inside \`${qualifierName}\`.`,
      sourceCode,
      `Remove the \`${qualifierName}.\` prefix.`,
    )
  },
}

function findEnclosingEnumOrNamespace(node: SyntaxNode, name: string): SyntaxNode | null {
  let current = node.parent
  while (current) {
    if (
      current.type === 'enum_declaration' ||
      current.type === 'module' ||  // TypeScript namespace
      current.type === 'internal_module'
    ) {
      const nameNode = current.childForFieldName('name')
      if (nameNode?.text === name) return current
    }
    current = current.parent
  }
  return null
}
