import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonDeeplyNestedFunctionsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/deeply-nested-functions',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    let depth = 0
    let parent = node.parent
    while (parent) {
      if (parent.type === 'function_definition') depth++
      parent = parent.parent
    }

    if (depth >= 3) {
      const nameNode = node.childForFieldName('name')
      const name = nameNode?.text || 'anonymous'
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Deeply nested function',
        `Function \`${name}\` is nested ${depth} levels deep. Extract to module scope for better readability.`,
        sourceCode,
        'Move the function to module scope or a separate file.',
      )
    }
    return null
  },
}
