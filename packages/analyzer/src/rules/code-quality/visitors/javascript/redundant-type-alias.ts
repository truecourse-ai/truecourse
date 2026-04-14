import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const redundantTypeAliasVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-type-alias',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['type_alias_declaration'],
  visit(node, filePath, sourceCode) {
    const nameNode = node.childForFieldName('name')
    const typeNode = node.childForFieldName('value')
    if (!nameNode || !typeNode) return null

    if (typeNode.type === 'type_identifier') {
      if (typeNode.text === nameNode.text) return null
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Redundant type alias',
        `Type alias \`${nameNode.text}\` just wraps \`${typeNode.text}\` without adding meaning.`,
        sourceCode,
        `Use \`${typeNode.text}\` directly, or rename it to convey semantic meaning.`,
      )
    }
    return null
  },
}
