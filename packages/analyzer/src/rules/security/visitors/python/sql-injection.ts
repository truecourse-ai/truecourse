import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const PYTHON_QUERY_METHODS = new Set([
  'execute', 'exec', 'raw', 'text',
  'executemany', 'executescript',
])

export const pythonSqlInjectionVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/sql-injection',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) methodName = attr.text
    } else if (fn.type === 'identifier') {
      methodName = fn.text
    }

    if (!PYTHON_QUERY_METHODS.has(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    if (firstArg.type === 'string' && firstArg.text.startsWith('f')) {
      const hasInterpolation = firstArg.namedChildren.some((c) => c.type === 'interpolation')
      if (hasInterpolation) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Potential SQL injection',
          `f-string with interpolation passed to ${methodName}(). Use parameterized queries instead.`,
          sourceCode,
          'Use parameterized queries (e.g., %s or :param) instead of f-strings in SQL.',
        )
      }
    }

    if (firstArg.type === 'binary_operator') {
      const op = firstArg.children.find((c) => c.text === '+')
      if (op) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Potential SQL injection',
          `String concatenation passed to ${methodName}(). Use parameterized queries instead.`,
          sourceCode,
          'Use parameterized queries (e.g., %s or :param) instead of string concatenation in SQL.',
        )
      }
    }

    return null
  },
}
