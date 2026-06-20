import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getRegexSource } from './_helpers.js'

// Tokenize the contents of a `[…]` character class into atomic "characters",
// keeping each escape (\uXXXX, \u{XXXX}, \xXX, \cA, or any \-prefixed shorthand)
// as one token. `-` is treated as a range separator and not pushed as a token.
function tokenizeCharClass(content: string): string[] {
  const tokens: string[] = []
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]
    if (ch === '\\' && i + 1 < content.length) {
      const next = content[i + 1]
      if (next === 'u') {
        // \u{XXXX...} — variable-length Unicode escape (u-flag mode)
        if (content[i + 2] === '{') {
          const close = content.indexOf('}', i + 3)
          if (close > 0) {
            tokens.push(content.slice(i, close + 1))
            i = close
            continue
          }
        }
        // \uXXXX — 4-digit Unicode escape
        if (i + 5 < content.length && /^[0-9a-fA-F]{4}$/.test(content.slice(i + 2, i + 6))) {
          tokens.push(content.slice(i, i + 6))
          i += 5
          continue
        }
      } else if (next === 'x') {
        // \xXX — 2-digit hex escape
        if (i + 3 < content.length && /^[0-9a-fA-F]{2}$/.test(content.slice(i + 2, i + 4))) {
          tokens.push(content.slice(i, i + 4))
          i += 3
          continue
        }
      } else if (next === 'c') {
        // \cA — control-character escape
        if (i + 2 < content.length && /^[A-Za-z]$/.test(content[i + 2])) {
          tokens.push(content.slice(i, i + 3))
          i += 2
          continue
        }
      } else if (next === 'p' || next === 'P') {
        // \p{Name} / \P{Name} — Unicode property escape (u-flag mode).
        // Consume the whole `\p{…}` as one atomic token so the letters
        // inside the property name (e.g. the two `I`s in `\p{ASCII}`) aren't
        // mistaken for repeated character-class members.
        if (content[i + 2] === '{') {
          const close = content.indexOf('}', i + 3)
          if (close > 0) {
            tokens.push(content.slice(i, close + 1))
            i = close
            continue
          }
        }
      }
      // Generic \X escape (\d, \w, \s, \., …)
      tokens.push(content.slice(i, i + 2))
      i++
    } else if (ch !== '-') {
      tokens.push(ch)
    }
  }
  return tokens
}

export const regexDuplicateCharClassVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-duplicate-char-class',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['regex', 'new_expression'],
  visit(node, filePath, sourceCode) {
    const src = getRegexSource(node)
    if (!src) return null

    const classRegex = /\[([^\]]*)\]/g
    let match: RegExpExecArray | null
    while ((match = classRegex.exec(src)) !== null) {
      const tokens = tokenizeCharClass(match[1])
      const seen = new Set<string>()
      for (const ch of tokens) {
        if (seen.has(ch)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Duplicate character in regex class',
            `Character class contains duplicate character \`${ch}\`.`,
            sourceCode,
            'Remove the duplicate character from the character class.',
          )
        }
        seen.add(ch)
      }
    }
    return null
  },
}
