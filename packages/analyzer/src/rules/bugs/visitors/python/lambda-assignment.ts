import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: x = lambda ...: ... (lambda assigned to a variable)

export const pythonLambdaAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/lambda-assignment',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    const right = node.childForFieldName('right')
    if (!right || right.type !== 'lambda') return null

    const left = node.childForFieldName('left')
    const varName = left?.text ?? 'f'

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Lambda assigned to variable',
      `\`${varName} = lambda ...\` assigns a lambda to a variable — use \`def ${varName}(...)\` instead. Lambda functions have no name in tracebacks, making debugging harder.`,
      sourceCode,
      `Replace with \`def ${varName}(...): ...\` for a named function.`,
    )
  },
}
