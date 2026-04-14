import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const unnecessaryCallApplyVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-call-apply',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (prop?.text !== 'call' && prop?.text !== 'apply') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argList = args.namedChildren

    if (prop.text === 'call') {
      if (argList.length === 0) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Unnecessary .call()',
          '`.call()` with no arguments is identical to a direct function call.',
          sourceCode,
          'Remove `.call()` and call the function directly.',
        )
      }
    }

    if (prop.text === 'apply') {
      if (argList.length === 0) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Unnecessary .apply()',
          '`.apply()` with no arguments is identical to a direct function call.',
          sourceCode,
          'Remove `.apply()` and call the function directly.',
        )
      }
    }

    return null
  },
}
