import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * An empty finalizer (`~Type() { }`) does nothing useful: declaring any
 * finalizer puts every instance of the type onto the finalization queue, so
 * the GC needs an extra generation to reclaim it. An empty one pays that cost
 * for no benefit and should be removed. A body containing only comments is
 * still empty.
 */
export const csharpEmptyFinalizerVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/empty-finalizer',
  languages: ['csharp'],
  nodeTypes: ['destructor_declaration'],
  visit(node, filePath, sourceCode) {
    const block = node.namedChildren.find((c) => c?.type === 'block')
    if (!block) return null

    const hasStatement = block.namedChildren.some((c) => c && c.type !== 'comment')
    if (hasStatement) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Empty finalizer',
      'An empty finalizer does nothing but force every instance of the type onto the finalization queue, delaying its collection by a GC generation for no benefit.',
      sourceCode,
      'Delete the empty finalizer.',
    )
  },
}
