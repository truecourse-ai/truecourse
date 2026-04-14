import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const consoleLogVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/console-log',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null
    const obj = fn.childForFieldName('object')
    const prop = fn.childForFieldName('property')
    if (!obj || !prop) return null
    if (obj.text !== 'console') return null
    if (prop.text !== 'log' && prop.text !== 'debug') return null

    // Skip CLI scripts, script files, and test files — console.log is expected there
    const lowerPath = filePath.toLowerCase()
    if (lowerPath.includes('/scripts/') || lowerPath.includes('/script/')) return null
    if (lowerPath.endsWith('.script.ts') || lowerPath.endsWith('.script.js')) return null
    if (/\.(test|spec|e2e)\.[jt]sx?$/.test(lowerPath)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `console.${prop.text} call`,
      `console.${prop.text} should be removed or replaced with a proper logger in production code.`,
      sourceCode,
      'Replace console.log/debug with a structured logger or remove it.',
    )
  },
}
