import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonConstantConditionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/constant-condition',
  languages: ['python'],
  nodeTypes: ['if_statement', 'while_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    if (!condition) return null

    // while True is idiomatic in Python — skip it
    if (node.type === 'while_statement' && condition.text === 'True') return null

    const PY_CONSTANTS = new Set(['True', 'False', 'None'])
    if (PY_CONSTANTS.has(condition.text) || condition.type === 'integer' || condition.type === 'float') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Constant condition',
        `Condition is always \`${condition.text}\` — this ${node.type === 'if_statement' ? 'branch' : 'loop'} is ${condition.text === 'False' || condition.text === 'None' || condition.text === '0' ? 'dead code' : 'always taken'}.`,
        sourceCode,
        'Remove the condition or fix the logic.',
      )
    }
    return null
  },
}
