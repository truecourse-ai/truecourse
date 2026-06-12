import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpRegexSite, validateDotNetRegex } from './_regex.js'

/**
 * `[]` in a .NET regex — unlike JavaScript (where `[]` is a valid
 * never-matching class), .NET treats a `]` directly after `[` as a literal
 * member, so `[]` never closes and `new Regex(...)` throws
 * "Unterminated [] set".
 */
export const csharpEmptyCharacterClassVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/empty-character-class',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression', 'invocation_expression', 'attribute'],
  visit(node, filePath, sourceCode) {
    const site = getCSharpRegexSite(node)
    if (!site) return null

    const error = validateDotNetRegex(site.pattern)
    if (!error || error.kind !== 'empty-class') return null

    return makeViolation(
      this.ruleKey, site.node, filePath, 'medium',
      'Empty character class in regex',
      'Empty character class `[]` — in .NET the first `]` is a literal member, so the set is unterminated and the regex throws ArgumentException at construction.',
      sourceCode,
      'Add characters to the character class or remove it.',
    )
  },
}
