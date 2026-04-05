import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const emptyCharacterClassVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/empty-character-class',
  languages: JS_LANGUAGES,
  nodeTypes: ['regex'],
  visit(node, filePath, sourceCode) {
    const pattern = node.childForFieldName('pattern')
    if (!pattern) return null

    const patternText = pattern.text
    // Match [] but not [^] or [\]] etc.
    // Look for [] that isn't preceded by a backslash
    const regex = /(?:^|[^\\])\[\]/
    if (regex.test(patternText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Empty character class in regex',
        'Empty character class `[]` in regex never matches anything.',
        sourceCode,
        'Add characters to the character class or remove it.',
      )
    }
    return null
  },
}
