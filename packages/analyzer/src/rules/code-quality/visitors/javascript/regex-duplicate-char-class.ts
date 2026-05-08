import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getRegexSource } from './_helpers.js'

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
      const classContent = match[1]
      // Tokenize the character class into "atoms" — single chars,
      // \\u{...} / \\u0000 / \\x00 / \\<single-char> escapes, and
      // ranges (\`a-z\`, \`\\u0300-\\u036f\`).
      const atoms: string[] = []
      let i = 0
      while (i < classContent.length) {
        const ch = classContent[i]
        let atom: string
        if (ch === '\\' && i + 1 < classContent.length) {
          const next = classContent[i + 1]
          // \\u{XXXX} — variable-length codepoint escape
          if (next === 'u' && classContent[i + 2] === '{') {
            const close = classContent.indexOf('}', i + 3)
            if (close !== -1) {
              atom = classContent.slice(i, close + 1)
              i = close + 1
            } else {
              atom = classContent.slice(i, i + 2)
              i += 2
            }
          } else if (next === 'u' && i + 6 <= classContent.length) {
            // \\uHHHH
            atom = classContent.slice(i, i + 6)
            i += 6
          } else if (next === 'x' && i + 4 <= classContent.length) {
            // \\xHH
            atom = classContent.slice(i, i + 4)
            i += 4
          } else {
            atom = classContent.slice(i, i + 2)
            i += 2
          }
        } else {
          atom = ch
          i += 1
        }
        // Coalesce \`atom-atom\` ranges into a single token.
        if (classContent[i] === '-' && i + 1 < classContent.length && classContent[i + 1] !== ']') {
          // Read the next atom as the range end.
          let endAtom: string
          let j = i + 1
          if (classContent[j] === '\\' && j + 1 < classContent.length) {
            const next = classContent[j + 1]
            if (next === 'u' && classContent[j + 2] === '{') {
              const close = classContent.indexOf('}', j + 3)
              if (close !== -1) { endAtom = classContent.slice(j, close + 1); j = close + 1 }
              else { endAtom = classContent.slice(j, j + 2); j += 2 }
            } else if (next === 'u' && j + 6 <= classContent.length) {
              endAtom = classContent.slice(j, j + 6); j += 6
            } else if (next === 'x' && j + 4 <= classContent.length) {
              endAtom = classContent.slice(j, j + 4); j += 4
            } else {
              endAtom = classContent.slice(j, j + 2); j += 2
            }
          } else {
            endAtom = classContent[j]; j += 1
          }
          atoms.push(`${atom}-${endAtom}`)
          i = j
          continue
        }
        atoms.push(atom)
      }

      const seen = new Set<string>()
      for (const a of atoms) {
        if (seen.has(a)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Duplicate character in regex class',
            `Character class contains duplicate character \`${a}\`.`,
            sourceCode,
            'Remove the duplicate character from the character class.',
          )
        }
        seen.add(a)
      }
    }
    return null
  },
}
