import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { singleCharStringLiteral } from './_helpers.js'

/**
 * `sb.Append("x")` goes through the string-appending overload to add a single
 * character; `sb.Append('x')` uses the `char` overload directly. `Append` is a
 * StringBuilder-specific method, so a one-character string literal argument is
 * a strong signal. Fires only on a single one-character string argument.
 */
export const csharpStringBuilderAppendSingleCharStringVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/stringbuilder-append-single-char-string',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpMethodName(node) !== 'Append') return null
    if (node.childForFieldName('function')?.type !== 'member_access_expression') return null

    const args = getCSharpArguments(node)
    if (args.length !== 1) return null
    if (singleCharStringLiteral(args[0]!) === null) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'StringBuilder.Append with a single-character string',
      'Appending a one-character string goes through the string overload; the char overload appends the single character without any string handling.',
      sourceCode,
      "Pass a char literal (e.g. ',') to Append instead of a single-character string.",
    )
  },
}
