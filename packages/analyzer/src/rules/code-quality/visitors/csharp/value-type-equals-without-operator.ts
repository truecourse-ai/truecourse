import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A struct that overrides `Equals` but does not define `operator ==` leaves
 * equality inconsistent: `a.Equals(b)` and `a == b` can disagree (the latter
 * falls back to field-by-field `ValueType.Equals`). The check fires on a
 * `struct_declaration` whose body declares a parameterless-receiver
 * `Equals(...)` override but no `==` operator.
 */
function bodyDeclares(typeBody: SyntaxNode): { equals: boolean; opEquality: boolean } {
  let equals = false
  let opEquality = false
  for (const member of typeBody.namedChildren) {
    if (member?.type === 'method_declaration') {
      if (member.childForFieldName('name')?.text === 'Equals') equals = true
    } else if (member?.type === 'operator_declaration') {
      if (member.childForFieldName('operator')?.text === '==') opEquality = true
    }
  }
  return { equals, opEquality }
}

export const csharpValueTypeEqualsWithoutOperatorVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/value-type-equals-without-operator',
  languages: ['csharp'],
  nodeTypes: ['struct_declaration'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren.find((c) => c?.type === 'declaration_list')
    if (!body) return null
    const { equals, opEquality } = bodyDeclares(body)
    if (!equals || opEquality) return null

    const name = node.childForFieldName('name')?.text ?? 'struct'
    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'ValueType.Equals override without operator==',
      `Struct \`${name}\` overrides \`Equals\` but does not define \`operator ==\`, leaving equality inconsistent between the method and the operator.`,
      sourceCode,
      'Also overload `operator ==` (and `!=`) so equality is consistent.',
    )
  },
}
