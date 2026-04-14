import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

function isLambdaNode(node: SyntaxNode): boolean {
  if (node.type === 'lambda') return true
  // Parenthesized lambda: (lambda x: x * 2)
  if (node.type === 'parenthesized_expression') {
    const inner = node.namedChildren[0]
    return inner?.type === 'lambda'
  }
  return false
}

export const pythonUnnecessaryDirectLambdaCallVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-direct-lambda-call',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || !isLambdaNode(fn)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Immediately invoked lambda',
      'A lambda is defined and immediately called. This is unnecessary — just write the expression directly.',
      sourceCode,
      'Remove the lambda wrapper and write the expression directly, or define a named function.',
    )
  },
}
