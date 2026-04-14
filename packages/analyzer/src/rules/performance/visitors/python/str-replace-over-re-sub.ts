import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const strReplaceOverReSubVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/str-replace-over-re-sub',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const obj = fn.childForFieldName('object')
    const attr = fn.childForFieldName('attribute')
    if (obj?.text !== 're' || attr?.text !== 'sub') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // If the pattern is a simple string literal (no regex metacharacters), suggest str.replace
    if (firstArg.type === 'string') {
      const patternText = firstArg.text.replace(/^['"]+|['"]+$/g, '')
      // Check for regex metacharacters
      if (!/[.^$*+?{}\\[\]|()]/.test(patternText)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          're.sub() for simple string replacement',
          `re.sub() with a plain string pattern '${patternText}' can be replaced with str.replace() for better performance.`,
          sourceCode,
          'Use str.replace() instead of re.sub() when the pattern is a plain string.',
        )
      }
    }

    return null
  },
}
