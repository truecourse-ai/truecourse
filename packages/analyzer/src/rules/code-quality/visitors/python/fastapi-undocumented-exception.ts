import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonDecoratorName, getPythonDecoratorFullName, containsPythonIdentifierExact } from '../../../_shared/python-helpers.js'

/**
 * Detects FastAPI route handlers that raise HTTPException but don't document
 * the response in the `responses` parameter of the route decorator.
 */
export const pythonFastapiUndocumentedExceptionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/fastapi-undocumented-exception',
  languages: ['python'],
  nodeTypes: ['decorated_definition'],
  visit(node, filePath, sourceCode) {
    const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch'])
    const decorators = node.namedChildren.filter((c) => c.type === 'decorator')
    const routeDecorator = decorators.find((d) => {
      const termName = getPythonDecoratorName(d)
      if (!termName || !HTTP_METHODS.has(termName)) return false
      // Verify the object is a router/app by checking the full name prefix
      const fullName = getPythonDecoratorFullName(d)
      if (!fullName) return false
      const parts = fullName.split('.')
      return parts.length >= 2 // e.g., 'router.get', 'app.post'
    })
    if (!routeDecorator) return null

    // Check if decorator has `responses` keyword argument
    const decoratorInner = routeDecorator.namedChildren[0]
    const callArgs = decoratorInner?.type === 'call'
      ? decoratorInner.childForFieldName('arguments')
      : null
    const hasResponsesArg = callArgs?.namedChildren.some((arg) =>
      arg.type === 'keyword_argument' && arg.childForFieldName('name')?.text === 'responses',
    ) ?? false
    if (hasResponsesArg) return null

    const funcNode = node.namedChildren.find((c) => c.type === 'function_definition' || c.type === 'async_function_definition')
    if (!funcNode) return null

    const body = funcNode.childForFieldName('body')
    if (!body) return null

    if (!containsPythonIdentifierExact(body, 'HTTPException')) return null

    // Get a status code from the raise if possible
    const statusMatch = body.text.match(/status_code=(\d+)/)
    const statusCode = statusMatch ? statusMatch[1] : 'HTTP error'

    const nameNode = funcNode.childForFieldName('name')
    const funcName = nameNode?.text ?? 'endpoint'

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Undocumented HTTPException in route handler',
      `Route handler \`${funcName}\` raises \`HTTPException\` (status ${statusCode}) but the response is not documented in the decorator's \`responses\` parameter — OpenAPI spec will be incomplete.`,
      sourceCode,
      `Add \`responses={${statusCode}: {"description": "..."}}\` to the route decorator.`,
    )
  },
}
