import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const noThrowLiteralVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-throw-literal',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['throw_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr) return null
    if (expr.type === 'string' || expr.type === 'number' || expr.type === 'template_string'
      || expr.type === 'null' || expr.type === 'undefined' || expr.type === 'true' || expr.type === 'false') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Throw literal',
        `Throwing a literal (${expr.text.slice(0, 30)}) loses the stack trace. Throw an Error object instead.`,
        sourceCode,
        'Replace with `throw new Error(...)` to preserve the stack trace.',
      )
    }
    return null
  },
}
