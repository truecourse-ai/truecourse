import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getMethodName, SQL_WRITE_METHODS } from './_helpers.js'

export const unsafeDeleteWithoutWhereVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/unsafe-delete-without-where',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const methodName = getMethodName(node)
    if (!SQL_WRITE_METHODS.has(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // Check string literal or template string
    let sqlText = ''
    if (firstArg.type === 'string') {
      sqlText = firstArg.text.slice(1, -1).toLowerCase()
    } else if (firstArg.type === 'template_string') {
      sqlText = firstArg.text.toLowerCase()
    } else {
      return null
    }

    const isDeleteOrUpdate =
      /^\s*(delete\s+from|update\s+\w+\s+set)/.test(sqlText)

    if (!isDeleteOrUpdate) return null

    const hasWhere = /\bwhere\b/.test(sqlText)
    if (hasWhere) return null

    const isDelete = /^\s*delete\s+from/.test(sqlText)
    const stmtType = isDelete ? 'DELETE' : 'UPDATE'

    return makeViolation(
      this.ruleKey, node, filePath, 'critical',
      `${stmtType} without WHERE clause`,
      `${stmtType} statement has no WHERE condition — this will affect every row in the table.`,
      sourceCode,
      `Add a WHERE clause to limit which rows are affected, or use a TRUNCATE statement intentionally.`,
    )
  },
}
