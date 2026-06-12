import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { getCallArgs, isPlainStringLiteral, lastSegment, staticStringText } from './_helpers.js'

/**
 * SQL built with string.Format/string.Concat — the C# analog of
 * format()/sprintf() SQL building. Requires a full SQL statement shape in
 * the format string plus at least one non-literal value argument.
 */
const SQL_STATEMENT_PATTERN = /\b(?:select\b[\s\S]*\bfrom\b|insert\s+into\b|update\b[\s\S]*\bset\b|delete\s+from\b|drop\s+(?:table|database)\b)/i

export const csharpHardcodedSqlExpressionVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/hardcoded-sql-expression',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const methodName = getCSharpMethodName(node)
    if (methodName !== 'Format' && methodName !== 'Concat' && methodName !== 'AppendFormat') return null

    const receiver = lastSegment(getCSharpReceiver(node))
    if (methodName !== 'AppendFormat' && receiver !== 'string' && receiver !== 'String') return null

    const args = getCallArgs(node)
    const formatArg = args[0]?.value
    if (!formatArg) return null
    if (!isPlainStringLiteral(formatArg)) return null
    if (!SQL_STATEMENT_PATTERN.test(staticStringText(formatArg))) return null

    // Require at least one non-literal value being formatted in.
    const valueArgs = args.slice(1)
    if (!valueArgs.some((a) => !isPlainStringLiteral(a.value) && a.value.type !== 'integer_literal')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Hardcoded SQL expression via string building',
      `${receiver ? receiver + '.' : ''}${methodName}() builds a SQL statement from runtime values. This is vulnerable to SQL injection.`,
      sourceCode,
      'Use parameterized queries (@p placeholders with command parameters) instead of formatting values into SQL.',
    )
  },
}
