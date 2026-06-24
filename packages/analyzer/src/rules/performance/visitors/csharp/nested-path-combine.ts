import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { getCSharpReceiverSimpleName } from './_helpers.js'

/**
 * `Path.Combine(a, Path.Combine(b, c))` (or `Path.Join`) can be flattened into
 * a single `Path.Combine(a, b, c)`: one call, one allocation, no intermediate
 * string. Fires on the *outer* call when one of its arguments is itself a
 * `Path.Combine`/`Path.Join` call, so each nesting is reported once.
 */
const PATH_METHODS = new Set(['Combine', 'Join'])

function isPathCombineCall(node: SyntaxNode): boolean {
  if (node.type !== 'invocation_expression') return false
  return PATH_METHODS.has(getCSharpMethodName(node)) && getCSharpReceiverSimpleName(node) === 'Path'
}

export const csharpNestedPathCombineVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/nested-path-combine',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (!isPathCombineCall(node)) return null

    const hasNested = getCSharpArguments(node).some((arg) => isPathCombineCall(arg))
    if (!hasNested) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Nested Path.Combine/Join',
      'Nested Path.Combine/Join calls can be collapsed into a single call: Path.Combine(a, b, c) instead of Path.Combine(a, Path.Combine(b, c)). One call, one allocation.',
      sourceCode,
      'Flatten the nested Path.Combine/Join into a single call with all segments as arguments.',
    )
  },
}
