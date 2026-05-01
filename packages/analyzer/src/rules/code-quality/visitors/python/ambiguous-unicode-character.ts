import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Identifier-confusable Unicode letters: non-Latin code points that render
// identical (or near-identical) to ASCII letters. The threat model is a
// homoglyph attack on identifiers — defining `аdmin` (Cyrillic `а`)
// alongside `admin` and getting a different binding past code review.
//
// Typographic punctuation (em-dash, en-dash, multiplication sign, smart
// quotes, soft hyphen, minus sign) is intentional copy in matplotlib
// labels, log messages, and docstrings. Restricting to letter-class
// confusables eliminates the ~100% FP rate this rule had on chart-label
// strings (the audit on signal7/ap_automation found 14/14 violations
// were `—` em-dashes / `×` multiplication signs in human prose).
const CONFUSABLE_MAP: Record<string, string> = {
  'ο': 'o',  // Greek small letter omicron
  'а': 'a',  // Cyrillic small a
  'е': 'e',  // Cyrillic small e
  'о': 'o',  // Cyrillic small o
  'р': 'p',  // Cyrillic small er
  'с': 'c',  // Cyrillic small es
  'х': 'x',  // Cyrillic small ha
  'ѕ': 's',  // Cyrillic small dze
  'і': 'i',  // Cyrillic small Byelorussian-Ukrainian I
  'ԁ': 'd',  // Cyrillic small komi de
  'ԛ': 'q',  // Cyrillic small qa
  'ԝ': 'w',  // Cyrillic small we
  'Ι': 'I',  // Greek capital iota
  'Ζ': 'Z',  // Greek capital zeta
  'Ο': 'O',  // Greek capital omicron
  'А': 'A',  // Cyrillic capital A
  'Е': 'E',  // Cyrillic capital E
  'К': 'K',  // Cyrillic capital Ka
  'М': 'M',  // Cyrillic capital Em
  'Н': 'H',  // Cyrillic capital En (renders as H)
  'О': 'O',  // Cyrillic capital O
  'Р': 'P',  // Cyrillic capital er
  'С': 'C',  // Cyrillic capital es
  'Т': 'T',  // Cyrillic capital te
  'Х': 'X',  // Cyrillic capital ha
}

export const pythonAmbiguousUnicodeCharacterVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/ambiguous-unicode-character',
  languages: ['python'],
  nodeTypes: ['string'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    for (const [confusable, ascii] of Object.entries(CONFUSABLE_MAP)) {
      if (text.includes(confusable)) {
        const hex = confusable.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Ambiguous Unicode character in string',
          `String contains Unicode character U+${hex} which looks like \`${ascii}\` but is not ASCII — can cause subtle bugs.`,
          sourceCode,
          `Replace the Unicode character U+${hex} with the ASCII equivalent \`${ascii}\`.`,
        )
      }
    }
    return null
  },
}
