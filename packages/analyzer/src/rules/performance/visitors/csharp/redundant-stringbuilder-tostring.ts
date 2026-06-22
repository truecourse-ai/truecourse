import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName, isCSharpStringNode } from '../../../_shared/csharp-helpers.js'

/**
 * `sb.Append("[" + value + "]")` builds the concatenated string on the heap
 * first and then appends it, defeating the builder. Chaining the parts
 * (`sb.Append('[').Append(value).Append(']')`) appends each directly. Fires
 * when the single `Append` argument is a `+` expression with at least one
 * string-literal operand — proof it is string concatenation, not arithmetic.
 */
function isStringConcat(node: SyntaxNode): boolean {
  if (node.type !== 'binary_expression') return false
  if (node.childForFieldName('operator')?.text !== '+') return false
  return collectAddOperands(node).some((n) => isCSharpStringNode(n))
}

function collectAddOperands(node: SyntaxNode): SyntaxNode[] {
  if (node.type === 'binary_expression' && node.childForFieldName('operator')?.text === '+') {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const out: SyntaxNode[] = []
    if (left) out.push(...collectAddOperands(left))
    if (right) out.push(...collectAddOperands(right))
    return out
  }
  return [node]
}

export const csharpRedundantStringBuilderToStringVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/redundant-stringbuilder-tostring',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpMethodName(node) !== 'Append') return null
    if (node.childForFieldName('function')?.type !== 'member_access_expression') return null

    const args = getCSharpArguments(node)
    if (args.length !== 1) return null
    if (!isStringConcat(args[0]!)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Optimize StringBuilder.Append call',
      'Passing a concatenated string to Append builds the whole string on the heap before appending, defeating the StringBuilder.',
      sourceCode,
      'Chain separate Append calls for each part instead of concatenating with + inside Append.',
    )
  },
}
