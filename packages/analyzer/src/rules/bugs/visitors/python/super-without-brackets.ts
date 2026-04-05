import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonSuperWithoutBracketsVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/super-without-brackets',
  languages: ['python'],
  nodeTypes: ['attribute'],
  visit(node, filePath, sourceCode) {
    // super.method — the object is `super` identifier (not a call)
    // In tree-sitter Python:
    //   `super.method` -> attribute { object: identifier('super'), attribute: identifier('method') }
    //   `super().method` -> attribute { object: call { function: identifier('super') }, ... }
    const obj = node.childForFieldName('object')
    if (!obj || obj.type !== 'identifier' || obj.text !== 'super') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'super without parentheses',
      '`super.method` references the `super` built-in without calling it — the MRO proxy is never created. Use `super().method` instead.',
      sourceCode,
      'Add parentheses: `super().method`.',
    )
  },
}
