import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Control characters that are invalid/dangerous in source code: backspace,
// SUB (^Z), ESC, NUL, zero-width space, zero-width no-break space.
// eslint-disable-next-line no-control-regex
const INVALID_CHARS_RE = /[\x00\x08\x1a\x1b\ufeff\u200b]/g

const CHAR_NAMES: Record<string, string> = {
  '\x00': 'NUL (\\x00)',
  '\x08': 'backspace (\\x08)',
  '\x1a': 'SUB/^Z (\\x1a)',
  '\x1b': 'ESC (\\x1b)',
  '\ufeff': 'zero-width no-break space (\\ufeff)',
  '\u200b': 'zero-width space (\\u200b)',
}

/**
 * Invisible control characters in the source file. A UTF-8 BOM (U+FEFF at
 * index 0) is the standard Visual Studio encoding signature and is NOT
 * flagged — only U+FEFF embedded later in the file.
 */
export const csharpInvalidCharacterInSourceVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/invalid-character-in-source',
  languages: ['csharp'],
  nodeTypes: ['compilation_unit'],
  visit(node, filePath, sourceCode) {
    INVALID_CHARS_RE.lastIndex = 0
    let match = INVALID_CHARS_RE.exec(sourceCode)
    if (match && match.index === 0 && match[0] === '\ufeff') {
      match = INVALID_CHARS_RE.exec(sourceCode)
    }
    if (!match) return null

    const char = match[0]
    const charName = CHAR_NAMES[char] ?? `\\u${char.codePointAt(0)?.toString(16).padStart(4, '0')}`

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Invalid control character in source file',
      `Source file contains an invisible control character: ${charName}. These characters can silently change program behavior and are not visible in most editors.`,
      sourceCode,
      'Remove or replace the invisible control character.',
    )
  },
}
