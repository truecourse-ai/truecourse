import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const SQL_FORMAT_FUNCTIONS = new Set(['format', 'sprintf', 'vsprintf'])

export const hardcodedSqlExpressionVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/hardcoded-sql-expression',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let funcName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    } else if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) funcName = prop.text
    }

    if (!SQL_FORMAT_FUNCTIONS.has(funcName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    const firstArgText = firstArg.text.toLowerCase()
    if (/select|insert|update|delete|from|where|into/.test(firstArgText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Hardcoded SQL expression via string building',
        `${funcName}() used to build a SQL query. This is vulnerable to SQL injection.`,
        sourceCode,
        'Use parameterized queries instead of string formatting for SQL.',
      )
    }

    return null
  },
}
