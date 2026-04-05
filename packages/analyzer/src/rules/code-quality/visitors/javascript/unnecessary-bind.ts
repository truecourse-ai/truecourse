import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const unnecessaryBindVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-bind',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (prop?.text !== 'bind') return null

    let callee = fn.childForFieldName('object')
    if (!callee) return null

    if (callee.type === 'parenthesized_expression') {
      callee = callee.namedChildren[0] ?? callee
    }

    if (callee.type === 'arrow_function') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Unnecessary .bind() on arrow function',
        'Arrow functions do not have their own `this` — `.bind()` has no effect on them.',
        sourceCode,
        'Remove the `.bind()` call — arrow functions capture `this` lexically.',
      )
    }

    return null
  },
}
