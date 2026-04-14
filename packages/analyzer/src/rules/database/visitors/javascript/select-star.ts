import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getMethodName, SQL_WRITE_METHODS } from './_helpers.js'

export const selectStarVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/select-star',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const methodName = getMethodName(node)
    if (!SQL_WRITE_METHODS.has(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    let sqlText = ''
    if (firstArg.type === 'string') {
      sqlText = firstArg.text.slice(1, -1).toLowerCase()
    } else if (firstArg.type === 'template_string') {
      sqlText = firstArg.text.toLowerCase()
    } else {
      return null
    }

    // Must be a SELECT statement with SELECT *
    if (!/^\s*select\s+\*/.test(sqlText)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'SELECT * in production code',
      `Fetching all columns with SELECT * wastes bandwidth and prevents index-only scans. Specify only the columns you need.`,
      sourceCode,
      'Replace SELECT * with an explicit column list.',
    )
  },
}
