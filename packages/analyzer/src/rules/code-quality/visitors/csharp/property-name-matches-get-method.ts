import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A type that declares both a property `X` and a parameterless method `GetX()`
 * gives readers two confusingly similar ways to obtain the same value.
 * The check fires on a `property_declaration` named `X` whose enclosing type
 * also declares a method named `GetX` taking no parameters. Fires once per
 * property to avoid double-reporting from the method side.
 */
function enclosingTypeBody(node: SyntaxNode): SyntaxNode | null {
  const body = node.parent
  return body?.type === 'declaration_list' ? body : null
}

export const csharpPropertyNameMatchesGetMethodVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/property-name-matches-get-method',
  languages: ['csharp'],
  nodeTypes: ['property_declaration'],
  visit(node, filePath, sourceCode) {
    const propName = node.childForFieldName('name')?.text
    if (!propName) return null

    const body = enclosingTypeBody(node)
    if (!body) return null

    const target = `Get${propName}`
    const hasGetMethod = body.namedChildren.some((member) => {
      if (member?.type !== 'method_declaration') return false
      if (member.childForFieldName('name')?.text !== target) return false
      const params = member.childForFieldName('parameters')
      return (params?.namedChildren.filter((c) => c?.type === 'parameter').length ?? 0) === 0
    })
    if (!hasGetMethod) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Property name matches a Get method',
      `Property \`${propName}\` coexists with a parameterless \`${target}()\` method — a confusing duplication of how the value is exposed.`,
      sourceCode,
      `Keep one accessor: either the property \`${propName}\` or the method \`${target}\`, not both.`,
    )
  },
}
