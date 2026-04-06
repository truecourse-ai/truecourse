import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects contradictory lookahead assertions in regex patterns.
 * E.g., r'(?=a)(?=b)' where both lookaheads at the same position
 * expect different single characters — can never match.
 * Also detects (?=a)(?!a) contradictions.
 */
export const pythonRegexLookaheadContradictoryVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/regex-lookahead-contradictory',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    const fnText = fn.text
    if (!/^re\.(compile|search|match|fullmatch|findall|sub|finditer|split)\b/.test(fnText)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    const pattern = extractPattern(firstArg)
    if (!pattern) return null

    // Find consecutive lookaheads: (?=X)(?=Y) or (?=X)(?!X) or (?!X)(?=X)
    const lookaheadPairs = /\(\?([=!])([^)]+)\)\(\?([=!])([^)]+)\)/g
    let match
    while ((match = lookaheadPairs.exec(pattern)) !== null) {
      const [, type1, content1, type2, content2] = match

      // (?=a)(?!a) — positive and negative for same pattern
      if (type1 !== type2 && content1 === content2) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Contradictory regex lookahead',
          `Positive lookahead (?=${content1}) contradicts negative lookahead (?!${content2}) — pattern can never match.`,
          sourceCode,
          'Remove the contradictory lookahead assertions.',
        )
      }

      // (?=a)(?=b) — two positive lookaheads for different single chars
      if (type1 === '=' && type2 === '=' && content1 !== content2) {
        // Only flag for simple single-character/class patterns
        if (/^[a-zA-Z0-9]$/.test(content1) && /^[a-zA-Z0-9]$/.test(content2)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Contradictory regex lookahead',
            `Lookahead (?=${content1}) contradicts (?=${content2}) — both require different characters at the same position.`,
            sourceCode,
            'Fix the lookahead assertions to be compatible.',
          )
        }
      }
    }

    return null
  },
}

function extractPattern(node: { type: string; text: string }): string | null {
  const text = node.text
  const match = text.match(/^[brBR]*['"]{1,3}(.*?)['"]{1,3}$/)
  if (match) return match[1]
  return null
}
