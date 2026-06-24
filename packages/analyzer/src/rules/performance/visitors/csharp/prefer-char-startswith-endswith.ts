import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { singleCharStringLiteral } from './_helpers.js'

/**
 * `s.StartsWith("/")` runs the culture-aware string comparison path to test a
 * single character; `s.StartsWith('/')` uses the ordinal `char` overload. Fires
 * when `StartsWith`/`EndsWith` is called with exactly one argument that is a
 * one-character string literal, so multi-char or `StringComparison`-bearing
 * calls are left alone.
 */
const METHODS = new Set(['StartsWith', 'EndsWith'])

export const csharpPreferCharStartsWithEndsWithVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/prefer-char-startswith-endswith',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (!METHODS.has(getCSharpMethodName(node))) return null
    if (node.childForFieldName('function')?.type !== 'member_access_expression') return null

    const args = getCSharpArguments(node)
    if (args.length !== 1) return null
    if (singleCharStringLiteral(args[0]!) === null) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Use the char overload of StartsWith / EndsWith',
      'Calling StartsWith/EndsWith with a one-character string uses the culture-aware string path; the char overload performs an ordinal single-character check.',
      sourceCode,
      "Pass a char literal (e.g. '/') instead of a single-character string.",
    )
  },
}
