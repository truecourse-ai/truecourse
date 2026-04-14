import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const EXPRESS_ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'use', 'all'])

export const expressAsyncNoWrapperVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/express-async-no-wrapper',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (!prop || !EXPRESS_ROUTE_METHODS.has(prop.text)) return null

    const obj = fn.childForFieldName('object')
    if (!obj) return null
    // Heuristic: object should be named app, router, or route
    const objName = obj.text
    if (objName !== 'app' && objName !== 'router' && objName !== 'route') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Check the last argument — should be the handler
    const lastArg = args.namedChildren[args.namedChildren.length - 1]
    if (!lastArg) return null

    // Check if it's an async arrow function or async function
    const isAsyncHandler =
      (lastArg.type === 'arrow_function' && lastArg.text.startsWith('async')) ||
      (lastArg.type === 'function' && lastArg.text.startsWith('async'))

    if (!isAsyncHandler) return null

    // Check if the async handler body has a try/catch wrapping its contents
    const body = lastArg.childForFieldName('body')
    if (body) {
      // If the body is a block with a try_statement as first child, it's wrapped
      if (body.type === 'statement_block') {
        const firstStatement = body.namedChildren[0]
        if (firstStatement?.type === 'try_statement') return null
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Express async handler without error wrapper',
      `Async function passed to ${objName}.${prop.text}() without try/catch. Unhandled rejections will not reach Express error handler.`,
      sourceCode,
      'Wrap the async handler in a try/catch, or use an async wrapper utility (e.g., asyncHandler).',
    )
  },
}
