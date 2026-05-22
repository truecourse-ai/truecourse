import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { findEnclosingFunction } from './_helpers.js'

export const missingNextOnErrorVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/missing-next-on-error',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    // Only flag in files that look like Express middleware/routes
    if (!filePath.match(/(?:route|middleware|controller|handler|api|server)/i)) return null

    // Check that the enclosing function has (req, res, next) or similar signature
    const func = findEnclosingFunction(node)
    if (!func) return null

    const params = func.childForFieldName('parameters') ?? func.childForFieldName('params')
    if (!params) return null

    const paramNames = params.namedChildren.map((p) => {
      // Handle typed params: name: Type
      const nameNode = p.childForFieldName('pattern') ?? p.childForFieldName('name') ?? p
      return nameNode.text.replace(/:.+/, '').trim()
    })

    // Must have an Express-shaped signature: (req, res, next) or (err, req, res, next).
    // Hono and Koa middleware are (ctx, next) with only two params and use
    // exception propagation rather than next(error); they must not be flagged.
    const hasNext = paramNames.some((n) => n === 'next')
    const hasReq = paramNames.some((n) => n === 'req' || n === 'request')
    const hasRes = paramNames.some((n) => n === 'res' || n === 'response')
    if (!hasNext || !hasReq || !hasRes) return null

    // Check the catch body for next(
    const body = node.childForFieldName('body')
    if (!body) return null

    if (body.text.includes('next(')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Missing next(error) in middleware catch',
      'Express middleware catch block does not call next(error). The error will be silently swallowed.',
      sourceCode,
      'Call next(error) in the catch block to forward the error to the Express error handler.',
    )
  },
}
