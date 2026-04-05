import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const noCallerVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-caller',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['member_expression'],
  visit(node, filePath, sourceCode) {
    const obj = node.childForFieldName('object')
    const prop = node.childForFieldName('property')

    if (obj?.text === 'arguments' && (prop?.text === 'caller' || prop?.text === 'callee')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        `arguments.${prop?.text} usage`,
        `\`arguments.${prop?.text}\` is deprecated, forbidden in strict mode, and can cause performance issues.`,
        sourceCode,
        `Remove the use of \`arguments.${prop?.text}\`. Use named functions or rest parameters instead.`,
      )
    }
    return null
  },
}
