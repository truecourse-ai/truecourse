import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isCSharpFunctionBoundary } from './_helpers.js'

/**
 * An `unsafe` block (`unsafe { … }`) that performs no pointer or `fixed`
 * operation grants pointer privileges for nothing, weakening the safety
 * guarantees a reader assumes from non-unsafe code (RCS1216). The check fires on
 * an `unsafe_statement` whose body contains no pointer type, `fixed` statement,
 * `stackalloc`, address-of (`&x`), or pointer indirection (`*p`).
 *
 * The `unsafe` *modifier* on a member is a different node (`unnecessary-unsafe-modifier`,
 * IDE0380) and is left to that rule; this rule scopes to the block form.
 */
const POINTER_NODE_TYPES = new Set(['pointer_type', 'fixed_statement', 'stackalloc_expression'])

function usesPointerOps(node: SyntaxNode, root: SyntaxNode): boolean {
  for (const child of node.namedChildren) {
    if (!child) continue
    // A nested unsafe-capable function owns its own pointer usage.
    if (isCSharpFunctionBoundary(child.type) && child.id !== root.id) continue
    if (POINTER_NODE_TYPES.has(child.type)) return true
    if (child.type === 'prefix_unary_expression') {
      const op = child.children[0]?.text
      if (op === '&' || op === '*') return true
    }
    if (usesPointerOps(child, root)) return true
  }
  return false
}

export const csharpUnnecessaryUnsafeContextVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-unsafe-context',
  languages: ['csharp'],
  nodeTypes: ['unsafe_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren.find((c) => c?.type === 'block')
    if (!body) return null
    if (usesPointerOps(body, node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Unnecessary unsafe context',
      'This `unsafe` block contains no pointer or `fixed` operation, so it grants pointer privileges for nothing.',
      sourceCode,
      'Remove the `unsafe` block — the code inside does not need it.',
    )
  },
}
