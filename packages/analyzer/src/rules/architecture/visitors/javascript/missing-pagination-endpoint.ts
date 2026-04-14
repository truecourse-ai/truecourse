import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isRouteHandler, getHandlerFromRouteCall } from './_helpers.js'

export const missingPaginationEndpointVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/missing-pagination-endpoint',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    if (!isRouteHandler(node)) return null

    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null
    const prop = fn.childForFieldName('property')
    if (prop?.text !== 'get') return null

    const handler = getHandlerFromRouteCall(node)
    if (!handler) return null

    const body = handler.childForFieldName('body')
    if (!body) return null
    const bodyText = body.text

    // Check if this looks like a list endpoint (returns array, findAll, findMany, etc.)
    const isListEndpoint =
      bodyText.includes('findAll') ||
      bodyText.includes('findMany') ||
      bodyText.includes('find({') ||
      bodyText.includes('.select(') ||
      bodyText.includes('SELECT *') ||
      bodyText.includes('SELECT *')

    if (!isListEndpoint) return null

    // Check for pagination
    const hasPagination =
      bodyText.includes('limit') ||
      bodyText.includes('offset') ||
      bodyText.includes('page') ||
      bodyText.includes('cursor') ||
      bodyText.includes('skip') ||
      bodyText.includes('take')

    if (hasPagination) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'List endpoint without pagination',
      'GET handler returns a list without pagination. This can return unbounded data.',
      sourceCode,
      'Add pagination (limit/offset or cursor-based) to the list endpoint.',
    )
  },
}
