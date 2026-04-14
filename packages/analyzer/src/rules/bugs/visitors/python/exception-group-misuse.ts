import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonExceptionGroupMisuseVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/exception-group-misuse',
  languages: ['python'],
  nodeTypes: ['except_clause'],
  visit(node, filePath, sourceCode) {
    // except* ExceptionGroup: — tree-sitter parses this as except_clause with a '*' child
    const children = node.children
    // Check if this is except* (has a '*' token after 'except')
    const exceptIdx = children.findIndex((c) => c.text === 'except')
    if (exceptIdx === -1) return null
    const starChild = children[exceptIdx + 1]
    if (!starChild || starChild.text !== '*') return null

    // Look for ExceptionGroup or BaseExceptionGroup as caught type
    for (const child of children) {
      if (child.type === 'identifier' &&
          (child.text === 'ExceptionGroup' || child.text === 'BaseExceptionGroup')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'ExceptionGroup caught with except*',
          `Catching \`${child.text}\` with \`except*\` causes infinite recursion — \`except*\` already wraps exceptions in an ExceptionGroup.`,
          sourceCode,
          `Use plain \`except ${child.text}:\` instead of \`except* ${child.text}:\`.`,
        )
      }
    }
    return null
  },
}
