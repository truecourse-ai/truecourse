import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonMethodName, PYTHON_SQL_METHODS } from './_helpers.js'

export const pythonSelectStarVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/select-star',
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

    if (!/^\s*['"]select\s+\*/.test(sqlText)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'SELECT * in production code',
      `Fetching all columns with SELECT * wastes bandwidth and prevents index-only scans. Specify only the columns you need.`,
      sourceCode,
      'Replace SELECT * with an explicit column list.',
    )
  },
}
