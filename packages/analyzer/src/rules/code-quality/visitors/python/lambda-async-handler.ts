import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

function isLambdaHandlerName(name: string): boolean {
  return name === 'handler' || name === 'lambda_handler' || name.endsWith('_handler')
}

function isAsyncFunction(node: SyntaxNode): boolean {
  return node.children.some((c) => c.type === 'async')
}

export const pythonLambdaAsyncHandlerVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/lambda-async-handler',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const nameNode = node.childForFieldName('name')
    if (!nameNode) return null

    const name = nameNode.text
    if (!isLambdaHandlerName(name)) return null
    if (!isAsyncFunction(node)) return null

    // Check parameters: AWS Lambda handlers have (event, context) signature
    const params = node.childForFieldName('parameters')
    if (!params) return null

    const paramList = params.namedChildren
    // Lambda handlers have exactly 2 parameters: event and context
    const hasLambdaSignature = paramList.length === 2

    if (!hasLambdaSignature) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Async Lambda handler',
      `\`${name}\` is defined as an \`async\` function but the AWS Lambda Python runtime does not support async handlers — the function will fail to execute.`,
      sourceCode,
      'Remove the `async` keyword and use synchronous code, or use an async runner like `asyncio.run()` inside a synchronous wrapper.',
    )
  },
}
