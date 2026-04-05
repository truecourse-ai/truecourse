import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const preferWhileVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-while',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const initializer = node.childForFieldName('initializer')
    const condition = node.childForFieldName('condition')
    const increment = node.childForFieldName('increment')

    const initIsEmpty = !initializer || initializer.type === 'empty_statement'
    if (initIsEmpty && condition && !increment) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Prefer while loop',
        '`for(;condition;)` with no initializer or increment is clearer as `while(condition)`.',
        sourceCode,
        'Replace `for(;condition;) { ... }` with `while(condition) { ... }`.',
      )
    }
    return null
  },
}
