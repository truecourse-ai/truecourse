import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `new InvalidOperationException("…");` as a standalone statement — the
 * exception is constructed but never thrown; the `throw` keyword is missing
 * and the failure is silently discarded.
 */
export const csharpUselessExceptionStatementVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/useless-exception-statement',
  languages: ['csharp'],
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr || expr.type !== 'object_creation_expression') return null

    const typeNode = expr.childForFieldName('type')
    if (!typeNode) return null
    const simpleName = (typeNode.text.split('.').pop() ?? '').replace(/<.*$/, '')
    if (!simpleName.endsWith('Exception')) return null

    return makeViolation(
      this.ruleKey, expr, filePath, 'high',
      'Exception created but not thrown',
      `\`new ${simpleName}(...)\` is created as a standalone statement but never thrown — the error is silently discarded.`,
      sourceCode,
      `Add \`throw\` before \`new ${simpleName}(...)\`.`,
    )
  },
}
