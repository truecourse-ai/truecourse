import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonWarningsNoStacklevelVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/warnings-no-stacklevel',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const func = node.childForFieldName('function')
    if (!func) return null

    const funcText = func.text
    if (funcText !== 'warnings.warn' && funcText !== 'warn') return null

    // For bare 'warn', verify it's likely the warnings.warn function
    // by checking if called directly (not as a method on something unexpected)
    if (funcText === 'warn') {
      // Could be any warn function; only flag if it looks like a direct import
      // We'll flag it since the rule applies to warnings.warn specifically
      // Skip bare `warn` to avoid false positives
      return null
    }

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Check if `stacklevel` keyword argument is present
    const hasStacklevel = args.namedChildren.some((arg) => {
      if (arg.type === 'keyword_argument') {
        const key = arg.childForFieldName('name')
        return key?.text === 'stacklevel'
      }
      return false
    })

    if (!hasStacklevel) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'warnings.warn without stacklevel',
        '`warnings.warn()` called without `stacklevel` parameter — the warning will point to the wrong location in user code.',
        sourceCode,
        'Add `stacklevel=2` (or appropriate level) to `warnings.warn()` so the warning points to the caller\'s code.',
      )
    }

    return null
  },
}
