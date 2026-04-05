import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const misleadingCharacterClassVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/misleading-character-class',
  languages: JS_LANGUAGES,
  nodeTypes: ['regex'],
  visit(node, filePath, sourceCode) {
    const pattern = node.childForFieldName('pattern')
    if (!pattern) return null

    const patternText = pattern.text

    // Find character classes in the regex pattern
    // Look for [...] blocks that contain characters with code points > 0xFFFF (multi-codepoint)
    // or emoji-like sequences (common emojis are in range U+1F000+)
    // We detect this by checking if any char in a character class has a code point > 0xFFFF
    // which means it's represented as a surrogate pair in JS strings
    let insideClass = false
    for (let i = 0; i < patternText.length; i++) {
      const ch = patternText[i]
      if (ch === '\\') { i++; continue } // skip escaped chars
      if (ch === '[') { insideClass = true; continue }
      if (ch === ']') { insideClass = false; continue }
      if (insideClass) {
        const cp = patternText.codePointAt(i)
        if (cp !== undefined && cp > 0xFFFF) {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Misleading character class in regex',
            `Regex character class contains a multi-codepoint character (code point U+${cp.toString(16).toUpperCase().padStart(4, '0')}) — in JavaScript, this is represented as a surrogate pair and the character class will only match individual surrogates, not the full character.`,
            sourceCode,
            'Use the `u` or `v` flag and escape the character as \\u{...}: `/[\\u{1F600}]/u`.',
          )
        }
      }
    }

    return null
  },
}
