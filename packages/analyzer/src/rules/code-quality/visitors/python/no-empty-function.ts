import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonNoEmptyFunctionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-empty-function',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const bodyNode = node.childForFieldName('body')
    if (!bodyNode || bodyNode.type !== 'block') return null

    const stmts = bodyNode.namedChildren
    // Allow pass, docstrings, and comments
    if (stmts.length === 0) {
      // Empty (shouldn't really happen in valid Python, but check anyway)
    } else if (stmts.length === 1) {
      const stmt = stmts[0]
      // A single `pass` with no comments → empty function
      if (stmt.type === 'pass_statement') {
        // Check if there are any comments in the block
        for (let i = 0; i < bodyNode.childCount; i++) {
          const child = bodyNode.child(i)
          if (child && child.type === 'comment') return null
        }
      } else {
        // Has actual content
        return null
      }
    } else {
      // More than one statement — not empty
      return null
    }

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text || 'anonymous'

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Empty function body',
      `Function \`${name}\` has an empty body (only \`pass\`). Add an implementation or a docstring explaining why.`,
      sourceCode,
      'Add an implementation, raise NotImplementedError, or add a docstring explaining why the body is empty.',
    )
  },
}
