import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Deep null-conditional chains: `a?.B?.C?.D?.E`. Same smell as JS deep
 * optional chaining — the code navigates an unvalidated shape instead of
 * validating it upfront.
 *
 * tree-sitter-c-sharp nests conditional_access_expression left-recursively
 * (the outermost node carries the last `?.`), with invocation / member-access
 * / element-access wrappers possibly sitting on the spine
 * (`svc?.Get()?.A?.B` → invocation wraps the inner conditional access).
 */
const SPINE_WRAPPERS = new Set([
  'invocation_expression',
  'member_access_expression',
  'element_access_expression',
  'postfix_unary_expression',
  'parenthesized_expression',
])

export const csharpUncheckedOptionalChainDepthVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/unchecked-optional-chain-depth',
  languages: ['csharp'],
  nodeTypes: ['conditional_access_expression'],
  visit(node, filePath, sourceCode) {
    // Only report on the outermost node of a chain: walk up through spine
    // wrappers; if we land on another conditional access whose spine we're
    // on, an outer visit already covers this chain.
    let current: SyntaxNode = node
    let parent: SyntaxNode | null = node.parent
    while (parent && SPINE_WRAPPERS.has(parent.type) && parent.namedChildren[0]?.id === current.id) {
      current = parent
      parent = parent.parent
    }
    if (parent?.type === 'conditional_access_expression' && parent.namedChildren[0]?.id === current.id) {
      return null
    }

    // Count `?.` hops down the spine.
    let depth = 0
    let spine: SyntaxNode | null = node
    while (spine) {
      if (spine.type === 'conditional_access_expression') {
        depth++
        spine = spine.namedChildren[0] ?? null
      } else if (SPINE_WRAPPERS.has(spine.type)) {
        spine = spine.namedChildren[0] ?? null
      } else {
        break
      }
    }

    if (depth <= 3) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Deep null-conditional chaining',
      `Null-conditional access ${depth} levels deep suggests missing data validation or an overly nested data shape.`,
      sourceCode,
      'Validate the object shape upfront (guard clauses or a validated DTO) instead of relying on deep ?. chains.',
    )
  },
}
