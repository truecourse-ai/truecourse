import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonStarArgAfterKeywordVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/star-arg-after-keyword',
  languages: ['python'],
  nodeTypes: ['argument_list'],
  visit(node, filePath, sourceCode) {
    const args = node.namedChildren
    let seenKeyword = false
    for (const arg of args) {
      if (arg.type === 'keyword_argument') {
        seenKeyword = true
      } else if (arg.type === 'list_splat' && seenKeyword) {
        // *args after keyword argument
        return makeViolation(
          this.ruleKey, arg, filePath, 'high',
          'Star-arg unpacking after keyword argument',
          '`*args` unpacking appears after a keyword argument — positional arguments must come before keyword arguments.',
          sourceCode,
          'Move all positional and `*args` arguments before keyword arguments.',
        )
      }
    }
    return null
  },
}
