import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpRegexSite, parseCharClasses } from './_regex.js'

/**
 * A character class containing an astral (multi-UTF-16-code-unit) character
 * like an emoji. .NET regex matches UTF-16 code units — `[👍]` matches the
 * individual surrogate halves, never the full character, and .NET has no
 * equivalent of JavaScript's `u` flag to fix it.
 */
export const csharpMisleadingCharacterClassVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/misleading-character-class',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression', 'invocation_expression', 'attribute'],
  visit(node, filePath, sourceCode) {
    const site = getCSharpRegexSite(node)
    if (!site) return null

    // Only flag characters typed raw in the source — explicit surrogate
    // escapes (`😀`) signal the author knows the encoding.
    let hasRawAstral = false
    for (const ch of site.node.text) {
      if ((ch.codePointAt(0) ?? 0) > 0xffff) {
        hasRawAstral = true
        break
      }
    }
    if (!hasRawAstral) return null

    const classes = parseCharClasses(site.pattern)
    for (const range of classes) {
      if (range.end === null) continue
      const content = site.pattern.slice(range.contentStart, range.end)
      for (let i = 0; i < content.length; i++) {
        if (content[i] === '\\') {
          i++
          continue
        }
        const cp = content.codePointAt(i)
        if (cp !== undefined && cp > 0xffff) {
          return makeViolation(
            this.ruleKey, site.node, filePath, 'medium',
            'Misleading character class in regex',
            `Regex character class contains a multi-code-unit character (U+${cp.toString(16).toUpperCase()}) — .NET regex matches UTF-16 code units, so the class only matches individual surrogate halves, never the full character.`,
            sourceCode,
            'Match the character outside a class (e.g. as an alternation), or match the surrogate pair explicitly.',
          )
        }
      }
    }
    return null
  },
}
