import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects exception instances created as standalone expression statements.
 * e.g., `ValueError("invalid value")` instead of `raise ValueError("invalid value")`
 */
export const pythonUselessExceptionStatementVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/useless-exception-statement',
  languages: ['python'],
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    // The expression should be a call to an exception constructor
    const expr = node.namedChildren[0]
    if (!expr || expr.type !== 'call') return null

    const func = expr.childForFieldName('function')
    if (!func) return null

    const funcText = func.text

    // Check if the function name ends with a common exception suffix
    const name = funcText.split('.').pop() ?? funcText
    const isException =
      name.endsWith('Error') ||
      name.endsWith('Exception') ||
      name.endsWith('Warning') ||
      name.endsWith('Interrupt') ||
      name === 'Exception' ||
      name === 'BaseException' ||
      name === 'StopIteration' ||
      name === 'StopAsyncIteration' ||
      name === 'KeyboardInterrupt' ||
      name === 'SystemExit' ||
      name === 'GeneratorExit'

    if (!isException) return null

    // Make sure this is not inside a raise statement (the parent is expression_statement)
    // which is already the case since we're visiting expression_statement

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Exception created but not raised',
      `\`${funcText}(...)\` is created as a statement but never raised — this likely has a missing \`raise\` keyword.`,
      sourceCode,
      `Add \`raise\` before the exception: \`raise ${funcText}(...)\`.`,
    )
  },
}
