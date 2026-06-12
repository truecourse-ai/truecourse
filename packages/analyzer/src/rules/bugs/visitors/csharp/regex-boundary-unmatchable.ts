import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import {
  getCSharpRegexSite,
  indexInsideCharClass,
  parseCharClasses,
  validateDotNetRegex,
} from './_regex.js'

/**
 * Anchors/boundaries in positions that can never match (.NET semantics —
 * identical for these cases, including RegexOptions.Multiline):
 *   - `$` followed by a literal alphanumeric: even in multiline mode the
 *     position after `$` holds a newline, so a letter never matches
 *   - a literal alphanumeric directly before `^`: ^ requires start (or a
 *     preceding newline in multiline) — a letter contradicts both
 *   - `\b\B` / `\B\b`: word-boundary and non-word-boundary at the same
 *     position is a contradiction
 */
export const csharpRegexBoundaryUnmatchableVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/regex-boundary-unmatchable',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression', 'invocation_expression', 'attribute'],
  visit(node, filePath, sourceCode) {
    const site = getCSharpRegexSite(node)
    if (!site || validateDotNetRegex(site.pattern)) return null

    const pattern = site.pattern
    const classes = parseCharClasses(pattern)
    const alnum = /[a-zA-Z0-9]/

    for (let i = 0; i < pattern.length; i++) {
      if (indexInsideCharClass(classes, i)) continue
      const ch = pattern[i]

      if (ch === '\\') {
        const pair = pattern.slice(i, i + 4)
        if (pair === '\\b\\B' || pair === '\\B\\b') {
          return makeViolation(
            this.ruleKey, site.node, filePath, 'high',
            'Unmatchable regex boundary',
            "`\\b` and `\\B` are asserted at the same position — word boundary and non-word-boundary simultaneously is contradictory, the pattern never matches.",
            sourceCode,
            'Remove one of the contradictory boundary assertions.',
          )
        }
        i++
        continue
      }

      if (ch === '$' && alnum.test(pattern[i + 1] ?? '')) {
        return makeViolation(
          this.ruleKey, site.node, filePath, 'high',
          'Unmatchable regex boundary',
          "`$` (end anchor) is followed by literal characters — nothing can match after the end of the input, so the pattern never matches.",
          sourceCode,
          'Remove the content after `$` or fix the anchor position.',
        )
      }

      if (
        ch === '^' &&
        i > 0 &&
        alnum.test(pattern[i - 1] ?? '') &&
        pattern[i - 2] !== '\\' &&
        !indexInsideCharClass(classes, i - 1)
      ) {
        return makeViolation(
          this.ruleKey, site.node, filePath, 'high',
          'Unmatchable regex boundary',
          "`^` (start anchor) appears after literal characters — the content before `^` makes the pattern unmatchable.",
          sourceCode,
          'Move `^` to the start of the pattern or the start of an alternative.',
        )
      }
    }

    return null
  },
}
