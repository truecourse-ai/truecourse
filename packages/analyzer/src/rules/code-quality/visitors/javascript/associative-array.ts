import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const associativeArrayVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/associative-array',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    if (!left || left.type !== 'subscript_expression') return null

    const index = left.childForFieldName('index')
    if (!index) return null

    if (index.type === 'string') {
      const obj = left.childForFieldName('object')
      if (!obj) return null
      const arrPatterns = /arr|items|list|array|data|collection/i
      if (obj.type === 'identifier' && arrPatterns.test(obj.text)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Array used as associative array',
          `Using string key \`${index.text}\` on \`${obj.text}\` — use an object or Map instead.`,
          sourceCode,
          'Replace the array with an object literal `{}` or a `Map` for string-keyed storage.',
        )
      }
    }
    return null
  },
}
