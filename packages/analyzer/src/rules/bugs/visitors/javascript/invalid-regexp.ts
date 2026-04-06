import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const invalidRegexpVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/invalid-regexp',
  languages: JS_LANGUAGES,
  nodeTypes: ['new_expression', 'call_expression'],
  visit(node, filePath, sourceCode) {
    // Handle both new RegExp(...) and RegExp(...)
    const fn = node.type === 'new_expression'
      ? node.childForFieldName('constructor')
      : node.childForFieldName('function')
    if (!fn || fn.text !== 'RegExp') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg || firstArg.type !== 'string') return null

    const pattern = firstArg.text.slice(1, -1) // strip quotes
    try {
      new RegExp(pattern)
    } catch {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Invalid regular expression',
        `RegExp pattern \`${pattern}\` is invalid and will throw a SyntaxError at runtime.`,
        sourceCode,
        'Fix the regular expression pattern.',
      )
    }
    return null
  },
}
