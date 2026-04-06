import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonMethodName, PYTHON_SQL_METHODS } from './_helpers.js'

export const pythonMissingMigrationVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/missing-migration',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    if (/migrat/i.test(filePath)) return null

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

    if (!/alter\s+table|create\s+table|drop\s+table|create\s+index|drop\s+index/.test(sqlText)) {
      return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Schema change outside migration file',
      `DDL statement found outside a migration file. Schema changes should be tracked in migrations.`,
      sourceCode,
      'Move this schema change into a versioned migration file.',
    )
  },
}
