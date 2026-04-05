import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const controlCharsInRegexVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/control-chars-in-regex',
  languages: JS_LANGUAGES,
  nodeTypes: ['regex'],
  visit(node, filePath, sourceCode) {
    const pattern = node.childForFieldName('pattern')
    if (!pattern) return null

    const patternText = pattern.text
    // Check for control characters (0x01-0x1f) that are not common escape sequences
    // eslint-disable-next-line no-control-regex
    const controlCharRegex = /[\x01-\x08\x0e-\x1f]/
    if (controlCharRegex.test(patternText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Control characters in regex',
        'This regex contains control characters that are likely unintentional.',
        sourceCode,
        'Use escape sequences like \\x01 instead of literal control characters.',
      )
    }
    return null
  },
}
