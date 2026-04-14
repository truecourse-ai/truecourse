import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { COMMON_PORTS } from './_helpers.js'

export const hardcodedPortVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/hardcoded-port',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['number'],
  visit(node, filePath, sourceCode) {
    const val = parseInt(node.text, 10)
    if (!COMMON_PORTS.has(val)) return null

    const parent = node.parent
    if (!parent) return null

    if (parent.type === 'arguments') {
      const callExpr = parent.parent
      if (!callExpr || callExpr.type !== 'call_expression') return null
      const fn = callExpr.childForFieldName('function')
      if (!fn) return null
      const fnText = fn.text
      if (fnText.includes('listen') || fnText.includes('connect') || fnText.includes('createServer')
        || fnText.includes('createConnection') || fnText === 'port') {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          `Hardcoded port ${val}`,
          `Port ${val} is hardcoded. Use an environment variable (e.g., \`process.env.PORT\`) or configuration instead.`,
          sourceCode,
          'Replace the hardcoded port with `process.env.PORT` or a config value.',
        )
      }
    }

    if (parent.type === 'variable_declarator' || parent.type === 'assignment_expression') {
      const nameNode = parent.childForFieldName('name') ?? parent.childForFieldName('left')
      if (nameNode?.text?.toLowerCase() === 'port') {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          `Hardcoded port ${val}`,
          `Port ${val} is hardcoded. Use an environment variable (e.g., \`process.env.PORT\`) or configuration instead.`,
          sourceCode,
          'Replace the hardcoded port with `process.env.PORT` or a config value.',
        )
      }
    }

    return null
  },
}
