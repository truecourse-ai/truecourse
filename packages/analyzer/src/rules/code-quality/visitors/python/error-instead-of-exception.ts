import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

function isInsideExcept(node: SyntaxNode): boolean {
  let cur: SyntaxNode | null = node.parent
  while (cur) {
    if (cur.type === 'except_clause') return true
    if (cur.type === 'function_definition') return false
    cur = cur.parent
  }
  return false
}

export const pythonErrorInsteadOfExceptionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/error-instead-of-exception',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    if (!isInsideExcept(node)) return null

    const fn = node.childForFieldName('function')
    if (!fn) return null

    let isLoggingError = false
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      const obj = fn.childForFieldName('object')
      if (attr?.text === 'error') {
        if (obj?.text === 'logging' || obj?.text === 'logger' || obj?.text === 'log') {
          isLoggingError = true
        }
      }
    }

    if (!isLoggingError) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'logging.error() instead of logging.exception()',
      '`logging.error()` in an except block loses the traceback. Use `logging.exception()` to include it automatically.',
      sourceCode,
      'Replace `logging.error()` with `logging.exception()` to preserve the stack trace.',
    )
  },
}
