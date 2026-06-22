import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * The first raw control character in a string, or null. Newline (0x0A) and
 * carriage return (0x0D) cannot appear inside a single-line string literal, so
 * any C0 control character here (notably tab 0x09) was typed as a raw,
 * invisible glyph rather than an escape.
 */
function firstControlChar(text: string): string | null {
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    if (code === 0x09 || (code >= 0x00 && code <= 0x08) || (code >= 0x0b && code <= 0x1f) || code === 0x7f) {
      return ch
    }
  }
  return null
}

/** Map a control code point to a readable name for the message. */
function controlName(ch: string): string {
  const code = ch.charCodeAt(0)
  if (code === 0x09) return 'a tab'
  if (code === 0x0b) return 'a vertical tab'
  if (code === 0x0c) return 'a form feed'
  return `a control character (U+${code.toString(16).padStart(4, '0').toUpperCase()})`
}

/**
 * A raw control character (tab, vertical tab, …) embedded directly in a string
 * literal. Such characters are invisible in source, so the literal's true
 * contents are easy to misread and trivially mangled by editors and diffs. The
 * escape form (`\t`, ``, …) is self-documenting and should be used
 * instead. Verbatim and raw string literals (`@"..."`, `"""..."""`)
 * intentionally hold literal text and are not flagged.
 */
export const csharpLiteralControlCharacterVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/literal-control-character',
  languages: ['csharp'],
  nodeTypes: ['string_literal'],
  visit(node, filePath, sourceCode) {
    const content = node.namedChildren.find((c) => c?.type === 'string_literal_content') as SyntaxNode | undefined
    if (!content) return null
    const ctrl = firstControlChar(content.text)
    if (!ctrl) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Control character in string literal',
      `This string literal contains ${controlName(ctrl)} written as a raw, invisible character.`,
      sourceCode,
      'Replace the raw control character with its escape sequence (e.g. `\\t`, `\\u000B`).',
    )
  },
}
