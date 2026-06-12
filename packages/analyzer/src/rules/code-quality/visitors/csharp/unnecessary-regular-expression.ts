import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { getCSharpStringValue } from './_regex-helpers.js'

const REGEX_META = /[.^$*+?{}[\]|()\\]/

/** Method → plain-string replacement. Replace is owned by performance/str-replace-over-re-sub. */
const STRING_EQUIVALENTS: Record<string, string> = {
  IsMatch: 'Contains',
  Split: 'Split',
}

/**
 * `Regex.IsMatch(input, "plain text")` / `Regex.Split(input, ",")` — the
 * pattern has no regex metacharacters, so the regex engine buys nothing over
 * `string.Contains` / `string.Split`.
 */
export const csharpUnnecessaryRegularExpressionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-regular-expression',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const method = getCSharpMethodName(node)
    const replacement = STRING_EQUIVALENTS[method]
    if (!replacement) return null
    if ((getCSharpReceiver(node).split('.').pop() ?? '') !== 'Regex') return null

    const args = getCSharpArguments(node)
    // Exactly (input, pattern): a RegexOptions argument changes semantics
    // (IgnoreCase etc.) and has no drop-in string equivalent.
    if (args.length !== 2) return null
    const pattern = args[1]!
    if (pattern.type !== 'string_literal' && pattern.type !== 'verbatim_string_literal') return null
    const patternText = getCSharpStringValue(pattern)
    if (!patternText || REGEX_META.test(patternText)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Regex for a plain string operation',
      `\`Regex.${method}\` with the literal pattern "${patternText}" contains no regex metacharacters — \`string.${replacement}\` does the same without the regex engine.`,
      sourceCode,
      `Replace \`Regex.${method}(input, "${patternText}")\` with \`input.${replacement}("${patternText}")\`.`,
    )
  },
}
