import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** A parameterless `recv.ToCharArray()` invocation, or null receiver text. */
function toCharArrayReceiverText(node: SyntaxNode): string | null {
  if (node.type !== 'invocation_expression') return null
  const fn = node.childForFieldName('function')
  if (fn?.type !== 'member_access_expression') return null
  if (fn.childForFieldName('name')?.text !== 'ToCharArray') return null
  // ToCharArray(start, length) copies a slice — that is not redundant.
  const args = node.childForFieldName('arguments')
  if (args && args.namedChildCount > 0) return null
  return fn.childForFieldName('expression')?.text ?? null
}

/**
 * A `string` is already an `IEnumerable<char>`, so `s.ToCharArray()` before a
 * `foreach` or a LINQ chain allocates a throwaway `char[]` for nothing
 * (RCS1107). Detected where the call is the `foreach` source. Only the
 * parameterless overload is flagged — `ToCharArray(start, length)` copies a
 * substring and is not redundant.
 */
export const csharpRedundantToCharArrayCallVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-tochararray-call',
  languages: ['csharp'],
  nodeTypes: ['foreach_statement'],
  visit(node, filePath, sourceCode) {
    // The iterated collection is the `in` operand (the `right` field).
    const source = node.childForFieldName('right')
    if (!source) return null
    const recv = toCharArrayReceiverText(source)
    if (recv == null) return null

    return makeViolation(
      this.ruleKey, source, filePath, 'low',
      'Redundant ToCharArray() call',
      `\`${recv}.ToCharArray()\` allocates a throwaway array — a string is already enumerable as \`char\`, so iterate it directly (RCS1107).`,
      sourceCode,
      'Remove the redundant `.ToCharArray()` and iterate the string directly.',
    )
  },
}
