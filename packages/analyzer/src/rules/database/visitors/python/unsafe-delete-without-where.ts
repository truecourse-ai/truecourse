import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonMethodName, PYTHON_SQL_METHODS } from './_helpers.js'

export const pythonUnsafeDeleteWithoutWhereVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/unsafe-delete-without-where',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const methodName = getPythonMethodName(node)
    if (!PYTHON_SQL_METHODS.has(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    let sqlText = ''
    if (firstArg.type === 'string') {
      sqlText = firstArg.text.toLowerCase()
    } else {
      return null
    }

    const isDeleteOrUpdate =
      /^\s*['"](delete\s+from|update\s+\w+\s+set)/.test(sqlText)

    if (!isDeleteOrUpdate) return null

    const hasWhere = /\bwhere\b/.test(sqlText)
    if (hasWhere) return null

    const isDelete = /delete\s+from/.test(sqlText)
    const stmtType = isDelete ? 'DELETE' : 'UPDATE'

    return makeViolation(
      this.ruleKey, node, filePath, 'critical',
      `${stmtType} without WHERE clause`,
      `${stmtType} statement has no WHERE condition — this will affect every row in the table.`,
      sourceCode,
      `Add a WHERE clause to limit which rows are affected.`,
    )
  },
}
