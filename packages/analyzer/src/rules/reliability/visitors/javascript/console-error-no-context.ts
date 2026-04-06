import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const consoleErrorNoContextVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/console-error-no-context',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const obj = fn.childForFieldName('object')
    const prop = fn.childForFieldName('property')
    if (obj?.text !== 'console' || prop?.text !== 'error') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Only flag if there's exactly one argument that looks like an error variable
    if (args.namedChildren.length !== 1) return null

    const arg = args.namedChildren[0]
    if (arg.type === 'identifier') {
      const name = arg.text.toLowerCase()
      if (name === 'e' || name === 'err' || name === 'error' || name === 'ex') {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'console.error() without context',
          `console.error(${arg.text}) logs only the error object. Add a descriptive message for better debugging.`,
          sourceCode,
          `Add context: console.error('Failed to <action>:', ${arg.text});`,
        )
      }
    }

    return null
  },
}
