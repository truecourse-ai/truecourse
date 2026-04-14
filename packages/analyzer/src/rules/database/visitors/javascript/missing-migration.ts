import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getMethodName, SQL_WRITE_METHODS } from './_helpers.js'

export const missingMigrationVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/missing-migration',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    // Skip if we are already in a migration file
    if (
      /migrat/i.test(filePath) ||
      /\d{14}/.test(filePath) // timestamp-named migration files
    ) {
      return null
    }

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

    if (!/^\s*(alter\s+table|create\s+table|drop\s+table|create\s+index|drop\s+index)/.test(sqlText)) {
      return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Schema change outside migration file',
      `DDL statement (ALTER TABLE / CREATE TABLE / etc.) found outside a migration file. Schema changes should be tracked in migrations.`,
      sourceCode,
      'Move this schema change into a versioned migration file.',
    )
  },
}
