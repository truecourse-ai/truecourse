import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects FastAPI route handlers that raise HTTPException but don't document
 * the response in the `responses` parameter of the route decorator.
 */
export const pythonFastapiUndocumentedExceptionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/fastapi-undocumented-exception',
  languages: ['python'],
  nodeTypes: ['decorated_definition'],
  visit(node, filePath, sourceCode) {
    const decorators = node.namedChildren.filter((c) => c.type === 'decorator')
    const routeDecorator = decorators.find((d) => {
      const text = d.text
      return (text.includes('.get(') || text.includes('.post(') || text.includes('.put(') || text.includes('.delete(') || text.includes('.patch(')) &&
        (text.includes('router.') || text.includes('app.'))
    })
    if (!routeDecorator) return null

    // Check if decorator has `responses` parameter
    if (routeDecorator.text.includes('responses')) return null

    const funcNode = node.namedChildren.find((c) => c.type === 'function_definition' || c.type === 'async_function_definition')
    if (!funcNode) return null

    const body = funcNode.childForFieldName('body')
    if (!body) return null

    const bodyText = body.text
    if (!bodyText.includes('HTTPException') && !bodyText.includes('raise HTTPException')) return null

    // Get a status code from the raise if possible
    const statusMatch = bodyText.match(/status_code=(\d+)/)
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
