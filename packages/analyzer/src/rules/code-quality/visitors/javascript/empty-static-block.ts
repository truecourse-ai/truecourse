import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const emptyStaticBlockVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/empty-static-block',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['class_static_block'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren.find((c) => c.type === 'statement_block')
    if (!body) return null
    if (body.namedChildCount === 0) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Empty static block',
        'Empty `static { }` class block has no purpose — remove it.',
        sourceCode,
        'Remove the empty static block.',
      )
    }
    return null
  },
}
