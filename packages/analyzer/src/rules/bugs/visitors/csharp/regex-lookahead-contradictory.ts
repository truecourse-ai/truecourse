import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import {
  getCSharpRegexSite,
  indexInsideCharClass,
  parseCharClasses,
  validateDotNetRegex,
} from './_regex.js'

/**
 * Adjacent lookaheads that contradict each other: `(?=a)(?!a)` (positive
 * and negative for the same content) or `(?=a)(?=b)` (two different single
 * characters required at the same position). Lookahead semantics are
 * identical in .NET.
 */
export const csharpRegexLookaheadContradictoryVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/regex-lookahead-contradictory',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression', 'invocation_expression', 'attribute'],
  visit(node, filePath, sourceCode) {
    const site = getCSharpRegexSite(node)
    if (!site || validateDotNetRegex(site.pattern)) return null

    const pattern = site.pattern
    const classes = parseCharClasses(pattern)
    const pairs = /\(\?([=!])([^)]+)\)\(\?([=!])([^)]+)\)/g
    let match: RegExpExecArray | null

    while ((match = pairs.exec(pattern)) !== null) {
      if (indexInsideCharClass(classes, match.index)) continue
      const [, type1, content1, type2, content2] = match

      if (type1 !== type2 && content1 === content2) {
        return makeViolation(
          this.ruleKey, site.node, filePath, 'high',
          'Contradictory regex lookahead',
          `Positive lookahead (?=${content1}) contradicts negative lookahead (?!${content1}) at the same position — the pattern can never match.`,
          sourceCode,
          'Remove the contradictory lookahead assertions.',
        )
      }

      if (type1 === '=' && type2 === '=' && content1 !== content2 &&
          /^[a-zA-Z0-9]$/.test(content1 ?? '') && /^[a-zA-Z0-9]$/.test(content2 ?? '')) {
        return makeViolation(
          this.ruleKey, site.node, filePath, 'high',
          'Contradictory regex lookahead',
          `Lookahead (?=${content1}) contradicts (?=${content2}) — both require a different character at the same position, so the pattern can never match.`,
          sourceCode,
          'Fix the lookahead assertions to be compatible.',
        )
      }
    }

    return null
  },
}
