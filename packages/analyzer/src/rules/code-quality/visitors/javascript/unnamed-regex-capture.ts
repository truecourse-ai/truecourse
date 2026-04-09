import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const unnamedRegexCaptureVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnamed-regex-capture',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['regex'],
  visit(node, filePath, sourceCode) {
    const pattern = node.namedChildren.find((c) => c.type === 'regex_pattern')
    const src = pattern?.text ?? ''

    let hasUnnamed = false
    for (let i = 0; i < src.length; i++) {
      if (src[i] === '\\') { i++; continue }
      if (src[i] === '(') {
        const next = src[i + 1]
        if (next !== '?') {
          // Extract the content of this capture group
          let depth = 1
          let j = i + 1
          while (j < src.length && depth > 0) {
            if (src[j] === '\\') { j += 2; continue }
            if (src[j] === '(') depth++
            else if (src[j] === ')') depth--
            j++
          }
          const groupContent = src.slice(i + 1, j - 1)

          // Skip groups that are purely alternation of short literals/tokens
          // e.g., (a|b), (\?|$), (http|https), (s?)
          if (groupContent.includes('|')) {
            const alternatives = groupContent.split('|')
            const isSimpleAlternation = alternatives.every((alt) => /^[a-zA-Z0-9_\\?.^$*+\-]+$/.test(alt) && alt.length <= 10)
            if (isSimpleAlternation) continue
          }

          hasUnnamed = true
          break
        }
      }
    }

    if (hasUnnamed) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Unnamed capture group',
        'Regex contains unnamed capture groups. Use named groups `(?<name>...)` for better readability.',
        sourceCode,
        'Convert capture groups to named: `(?<name>...)` or non-capturing: `(?:...)`.',
      )
    }
    return null
  },
}
