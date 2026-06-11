import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpRegexSite, validateDotNetRegex } from './_regex.js'

/**
 * Regex pattern literals that are guaranteed to throw ArgumentException
 * when the Regex is constructed (.NET syntax — possessive quantifiers like
 * `a++` are "nested quantifier" errors in .NET, unterminated classes and
 * unbalanced parens throw, `{2,1}` is a reversed range).
 */
export const csharpInvalidRegexpVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/invalid-regexp',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression', 'invocation_expression', 'attribute'],
  visit(node, filePath, sourceCode) {
    const site = getCSharpRegexSite(node)
    if (!site) return null

    const error = validateDotNetRegex(site.pattern)
    // `[]` is owned by bugs/deterministic/empty-character-class.
    if (!error || error.kind === 'empty-class') return null

    return makeViolation(
      this.ruleKey, site.node, filePath, 'high',
      'Invalid regular expression',
      `Regex pattern \`${site.pattern}\` is invalid for .NET — ${error.message} — and will throw ArgumentException at runtime.`,
      sourceCode,
      'Fix the regular expression pattern.',
    )
  },
}
