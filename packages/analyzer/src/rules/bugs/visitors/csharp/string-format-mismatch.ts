import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName, getCSharpReceiver, getCSharpStringText, isCSharpStringNode } from '../../../_shared/csharp-helpers.js'
import { isScalarLiteral, parseCompositeFormatIndexes } from './_helpers.js'

/**
 * `string.Format("{0} … {1}", a)` referencing more arguments than supplied —
 * throws FormatException at runtime.
 *
 * Recall guards (no type info): a leading IFormatProvider argument is
 * skipped; when only ONE value argument is supplied and it is not a scalar
 * literal it could be a `params object[]` array that expands, so the call is
 * not judged.
 */
export const csharpStringFormatMismatchVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/string-format-mismatch',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpMethodName(node) !== 'Format') return null
    const receiver = getCSharpReceiver(node).split('.').pop() ?? ''
    if (receiver !== 'string' && receiver !== 'String') return null

    const args = getCSharpArguments(node)
    if (args.length === 0) return null

    // The format string is the first string-literal argument among the first
    // two (a CultureInfo/IFormatProvider may come first).
    let fmtIndex = -1
    for (let i = 0; i < Math.min(2, args.length); i++) {
      if (isCSharpStringNode(args[i]!) && args[i]!.type !== 'interpolated_string_expression') {
        fmtIndex = i
        break
      }
    }
    if (fmtIndex === -1) return null

    const fmt = getCSharpStringText(args[fmtIndex]!)
    if (fmt === null) return null

    const indexes = parseCompositeFormatIndexes(fmt)
    if (indexes === null || indexes.length === 0) return null
    const required = Math.max(...indexes) + 1

    const valueArgs: SyntaxNode[] = args.slice(fmtIndex + 1)
    if (valueArgs.length >= required) return null

    // A single non-literal argument may be a params object[] that expands.
    if (valueArgs.length === 1 && !isScalarLiteral(valueArgs[0]!)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'String format argument count mismatch',
      `The format string references {${required - 1}} (${required} argument${required !== 1 ? 's' : ''} required) but only ${valueArgs.length} ${valueArgs.length === 1 ? 'was' : 'were'} provided — this throws FormatException at runtime.`,
      sourceCode,
      `Provide ${required} argument(s) for the format string, or fix the placeholder indexes.`,
    )
  },
}
