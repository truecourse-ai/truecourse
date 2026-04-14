import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonEmptyCatchVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/empty-catch',
  languages: ['python'],
  nodeTypes: ['except_clause'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren.find((c) => c.type === 'block')
    if (!body) return null
    const statements = body.namedChildren.filter((c) => c.type !== 'comment')
    if (statements.length === 0 || (statements.length === 1 && statements[0].type === 'pass_statement')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Empty except block',
        'This except block swallows errors silently. Add error handling or at least log the error.',
        sourceCode,
        'Add error logging or re-raise the exception in this except block.',
      )
    }
    return null
  },
}
