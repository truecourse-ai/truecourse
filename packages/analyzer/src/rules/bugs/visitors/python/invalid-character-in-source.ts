import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Control characters that are invalid/dangerous in source code
// Matches PLE2510-PLE2515: backspace, sub (^Z), esc, nul, zero-width space, zero-width no-break space
const INVALID_CHARS_RE = /[\x00\x08\x1a\x1b\ufeff\u200b]/

const CHAR_NAMES: Record<string, string> = {
  '\x00': 'NUL (\\x00)',
  '\x08': 'backspace (\\x08)',
  '\x1a': 'SUB/^Z (\\x1a)',
  '\x1b': 'ESC (\\x1b)',
  '\ufeff': 'zero-width no-break space (\\ufeff)',
  '\u200b': 'zero-width space (\\u200b)',
}

export const pythonInvalidCharacterInSourceVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/invalid-character-in-source',
  languages: ['python'],
  nodeTypes: ['module'],
  visit(node, filePath, sourceCode) {
    const match = INVALID_CHARS_RE.exec(sourceCode)
    if (!match) return null

    const char = match[0]
    const charName = CHAR_NAMES[char] ?? `\\u${char.codePointAt(0)?.toString(16).padStart(4, '0')}`

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Invalid control character in source file',
      `Source file contains an invisible control character: ${charName}. These characters can silently change program behavior and are not visible in most editors.`,
      sourceCode,
      'Remove or replace the invisible control character. Use a hex editor or specialized tool to find and remove it.',
    )
  },
}
