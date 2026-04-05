import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Lookalike Unicode characters that are visually similar to ASCII equivalents
// Maps confusable → ASCII equivalent
const CONFUSABLE_MAP: Record<string, string> = {
  '\u00B4': "'",   // acute accent → apostrophe
  '\u2018': "'",   // left single quote → apostrophe
  '\u2019': "'",   // right single quote → apostrophe
  '\u201C': '"',   // left double quote → double quote
  '\u201D': '"',   // right double quote → double quote
  '\u2013': '-',   // en dash → hyphen
  '\u2014': '--',  // em dash → double hyphen
  '\u00AD': '-',   // soft hyphen
  '\u2212': '-',   // minus sign
  '\u00D7': 'x',  // multiplication sign
  '\u03BF': 'o',  // Greek small letter omicron
  '\u0430': 'a',  // Cyrillic small a
  '\u0435': 'e',  // Cyrillic small e
  '\u043E': 'o',  // Cyrillic small o
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
