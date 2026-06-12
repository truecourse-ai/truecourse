import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName, getCSharpReceiver, getCSharpStringText } from '../../../_shared/csharp-helpers.js'

/**
 * `Regex.Replace(input, "plain", "text")` where the pattern has no regex
 * metacharacters and the replacement has no substitutions — string.Replace()
 * does the same without the regex engine. The C# analog of re.sub() with a
 * plain string pattern.
 */
const REGEX_META = /[.^$*+?{}\\[\]|()\\]/

export const csharpStrReplaceOverReSubVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/str-replace-over-re-sub',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpMethodName(node) !== 'Replace') return null
    if ((getCSharpReceiver(node).split('.').pop() ?? '') !== 'Regex') return null

    const args = getCSharpArguments(node)
    if (args.length < 3) return null

    const pattern = args[1]!
    if (pattern.type !== 'string_literal' && pattern.type !== 'verbatim_string_literal') return null
    const patternText = getCSharpStringText(pattern)
    if (!patternText || REGEX_META.test(patternText)) return null

    // Replacement must be a plain literal too — "$1" substitutions need the regex engine.
    const replacement = args[2]!
    if (replacement.type !== 'string_literal' && replacement.type !== 'verbatim_string_literal') return null
    const replacementText = getCSharpStringText(replacement)
    if (replacementText === null || replacementText.includes('$')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Regex.Replace() for a plain string replacement',
      `Regex.Replace() with the literal pattern "${patternText}" spins up the regex engine for a plain substring swap. string.Replace() is simpler and faster.`,
      sourceCode,
      `Replace Regex.Replace(input, "${patternText}", ...) with input.Replace("${patternText}", ...).`,
    )
  },
}
