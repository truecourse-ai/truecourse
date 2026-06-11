import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_REGEX_NODE_TYPES, getCSharpRegexUsage } from './_regex-helpers.js'

// Tokenize the contents of a `[…]` character class into atomic "characters",
// keeping each escape (\uXXXX, \xXX, \cA, or any \-prefixed shorthand) as one
// token. `-` is treated as a range separator and not pushed as a token.
function tokenizeCharClass(content: string): string[] {
  const tokens: string[] = []
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]!
    if (ch === '\\' && i + 1 < content.length) {
      const next = content[i + 1]
      if (next === 'u') {
        if (i + 5 < content.length && /^[0-9a-fA-F]{4}$/.test(content.slice(i + 2, i + 6))) {
          tokens.push(content.slice(i, i + 6))
          i += 5
          continue
        }
      } else if (next === 'x') {
        if (i + 3 < content.length && /^[0-9a-fA-F]{2}$/.test(content.slice(i + 2, i + 4))) {
          tokens.push(content.slice(i, i + 4))
          i += 3
          continue
        }
      } else if (next === 'c') {
        if (i + 2 < content.length && /^[A-Za-z]$/.test(content[i + 2]!)) {
          tokens.push(content.slice(i, i + 3))
          i += 2
          continue
        }
      } else if (next === 'p' || next === 'P') {
        // \p{Lu} Unicode category — one token through the closing brace.
        if (content[i + 2] === '{') {
          const close = content.indexOf('}', i + 3)
          if (close > 0) {
            tokens.push(content.slice(i, close + 1))
            i = close
            continue
          }
        }
      }
      tokens.push(content.slice(i, i + 2))
      i++
    } else if (ch !== '-') {
      tokens.push(ch)
    }
  }
  return tokens
}

export const csharpRegexDuplicateCharClassVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-duplicate-char-class',
  languages: ['csharp'],
  nodeTypes: CSHARP_REGEX_NODE_TYPES,
  visit(node, filePath, sourceCode) {
    const usage = getCSharpRegexUsage(node)
    if (!usage) return null
    const src = usage.pattern

    // Extract each character class body (handling escaped brackets).
    const classes: string[] = []
    let inClass = false
    let current = ''
    for (let i = 0; i < src.length; i++) {
      const ch = src[i]
      if (ch === '\\') {
        if (inClass) current += src.slice(i, i + 2)
        i++
        continue
      }
      if (!inClass && ch === '[') {
        inClass = true
        current = ''
        continue
      }
      if (inClass && ch === ']') {
        inClass = false
        classes.push(current)
        continue
      }
      if (inClass) current += ch
    }

    for (const body of classes) {
      // .NET supports class subtraction `[a-z-[aeiou]]`; skip those bodies —
      // the inner class chars legitimately repeat the outer range.
      if (body.includes('-[')) continue
      const tokens = tokenizeCharClass(body.replace(/^\^/, ''))
      const seen = new Set<string>()
      for (const token of tokens) {
        if (seen.has(token)) {
          return makeViolation(
            this.ruleKey, usage.patternNode, filePath, 'low',
            'Duplicate character in character class',
            `Character \`${token}\` appears more than once in the character class \`[${body}]\`.`,
            sourceCode,
            'Remove the duplicate character from the character class.',
          )
        }
        seen.add(token)
      }
    }
    return null
  },
}
