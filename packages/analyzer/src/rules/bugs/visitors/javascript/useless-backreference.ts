import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const uselessBackreferenceVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/useless-backreference',
  languages: JS_LANGUAGES,
  nodeTypes: ['regex'],
  visit(node, filePath, sourceCode) {
    const pattern = node.childForFieldName('pattern')
    if (!pattern) return null

    const patternText = pattern.text

    // Look for numbered backreferences \1, \2, etc. that reference groups that appear later
    // e.g. /\1(abc)/ — \1 is a forward-reference, always matches empty string
    const backrefMatch = patternText.match(/\\([1-9]\d*)/)
    if (backrefMatch) {
      const refNum = parseInt(backrefMatch[1], 10)
      // Count capturing groups before the backreference position
      const backrefPos = patternText.indexOf(backrefMatch[0])
      const beforeRef = patternText.slice(0, backrefPos)
      // Count unescaped opening parens that are capturing (not (?:, (?=, (?!, etc.)
      const captureGroupsBefore = (beforeRef.match(/(?<!\\)\((?!\?)/g) || []).length
      if (captureGroupsBefore < refNum) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Useless regex backreference',
          `Backreference \`\\${refNum}\` references a group that hasn't been defined yet at that point in the pattern — it always matches the empty string.`,
          sourceCode,
          'Move the referenced group before the backreference, or use a named group with (?<name>...) and \\k<name>.',
        )
      }
    }

    return null
  },
}
