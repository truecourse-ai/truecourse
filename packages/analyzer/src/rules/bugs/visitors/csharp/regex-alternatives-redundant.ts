import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpRegexSite, splitTopLevelAlternatives, validateDotNetRegex } from './_regex.js'

/**
 * Duplicate top-level alternatives (`cat|dog|cat`) and literal-prefix
 * subsumption (`err|error` — `err` always wins at the same position).
 * .NET alternation is leftmost-preference, same as PCRE/JS/Python.
 */
export const csharpRegexAlternativesRedundantVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/regex-alternatives-redundant',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression', 'invocation_expression', 'attribute'],
  visit(node, filePath, sourceCode) {
    const site = getCSharpRegexSite(node)
    if (!site || validateDotNetRegex(site.pattern)) return null

    const alternatives = splitTopLevelAlternatives(site.pattern)
    if (alternatives.length < 2) return null

    for (let i = 0; i < alternatives.length; i++) {
      for (let j = i + 1; j < alternatives.length; j++) {
        if (alternatives[i] === alternatives[j]) {
          return makeViolation(
            this.ruleKey, site.node, filePath, 'medium',
            'Redundant regex alternative',
            `Duplicate alternative '${alternatives[i]}' in regex pattern.`,
            sourceCode,
            'Remove the duplicate alternative from the regex.',
          )
        }
      }
    }

    for (let i = 0; i < alternatives.length; i++) {
      for (let j = 0; j < alternatives.length; j++) {
        if (i === j) continue
        const a = alternatives[i]!
        const b = alternatives[j]!
        // Only simple literal alternatives — no metacharacters involved.
        if (/^[a-zA-Z0-9_]+$/.test(a) && /^[a-zA-Z0-9_]+$/.test(b) && b.startsWith(a) && a !== b && i < j) {
          return makeViolation(
            this.ruleKey, site.node, filePath, 'medium',
            'Redundant regex alternative',
            `Alternative '${a}' makes '${b}' redundant — '${a}' is listed first and always matches at the same position.`,
            sourceCode,
            'Reorder alternatives (longer first) or remove the redundant one.',
          )
        }
      }
    }

    return null
  },
}
