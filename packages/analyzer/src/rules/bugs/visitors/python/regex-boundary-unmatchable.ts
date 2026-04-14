import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects unmatchable regex boundary usage.
 * E.g., r'\bfoo\b' is fine but r'\b\b' or r'$foo' or r'foo^' are likely bugs
 * where boundaries are used in positions that can never match.
 */
export const pythonRegexBoundaryUnmatchableVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/regex-boundary-unmatchable',
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

    // $ followed by literal chars (not in a group or alternation context)
    // This means "end of string" followed by more content — unmatchable
    if (/\$[a-zA-Z0-9]/.test(pattern) && !/\$[)}|]/.test(pattern.slice(pattern.indexOf('$'), pattern.indexOf('$') + 2))) {
      // Check it's not an escaped \$
      const idx = pattern.indexOf('$')
      if (idx > 0 && pattern[idx - 1] === '\\') {
        // escaped, skip
      } else {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Unmatchable regex boundary',
          `'$' (end-of-string anchor) is followed by literal characters — the pattern after '$' can never match.`,
          sourceCode,
          'Remove the content after $ or fix the anchor position.',
        )
      }
    }

    // Literal chars followed by ^ (not at start, not in char class)
    // Pattern like 'foo^bar' where ^ is not at start
    const caretIdx = pattern.indexOf('^')
    if (caretIdx > 0 && pattern[caretIdx - 1] !== '\\' && pattern[caretIdx - 1] !== '[') {
      // Check there's actual content before ^
      const before = pattern.slice(0, caretIdx)
      if (/[a-zA-Z0-9]$/.test(before) && !/\|$/.test(before)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Unmatchable regex boundary',
          `'^' (start-of-string anchor) appears after literal characters — the content before '^' makes this unmatchable.`,
          sourceCode,
          'Move ^ to the start of the pattern or the start of an alternative.',
        )
      }
    }

    // Consecutive boundaries: \b\b is valid but \b\B is contradictory
    if (/\\b\\B|\\B\\b/.test(pattern)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unmatchable regex boundary',
        `'\\b' and '\\B' used consecutively — word boundary and non-word boundary at the same position is contradictory.`,
        sourceCode,
        'Remove one of the contradictory boundary assertions.',
      )
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
