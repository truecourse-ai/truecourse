import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Identifier-confusable Unicode letters: non-Latin code points that render
// identical (or near-identical) to ASCII letters — the homoglyph-attack /
// fat-finger surface. Only MIXED-script identifiers are flagged: an
// identifier written entirely in Cyrillic/Greek is legitimate localized
// code, while one Cyrillic `а` inside an otherwise-Latin identifier is a
// near-certain defect. Strings are not scanned at all (localized text mixes
// scripts routinely). Bidi controls and invisible whitespace are owned by
// the bugs-domain visitors.
const CONFUSABLE_MAP: Record<string, string> = {
  'ο': 'o', 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x',
  'ѕ': 's', 'і': 'i', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w',
  'Ι': 'I', 'Ζ': 'Z', 'Ο': 'O',
  'А': 'A', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O',
  'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X',
}

export const csharpAmbiguousUnicodeCharacterVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/ambiguous-unicode-character',
  languages: ['csharp'],
  nodeTypes: ['identifier'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    if (!/[A-Za-z]/.test(text)) return null

    for (const [confusable, ascii] of Object.entries(CONFUSABLE_MAP)) {
      if (!text.includes(confusable)) continue
      const hex = confusable.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Ambiguous Unicode character in identifier',
        `Identifier \`${text}\` mixes ASCII letters with U+${hex}, which renders like \`${ascii}\` but is a different character — it silently creates a distinct symbol.`,
        sourceCode,
        `Replace the Unicode character U+${hex} with the ASCII letter \`${ascii}\`.`,
      )
    }
    return null
  },
}
