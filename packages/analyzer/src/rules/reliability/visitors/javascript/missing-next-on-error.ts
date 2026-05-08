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

    // Must have a next-like param (usually 3rd or 4th param)
    const hasNext = paramNames.some((n) => n === 'next')
    if (!hasNext) return null

    // Skip Hono / Koa / Elysia middleware. Express signature is
    // \`(req, res, next)\`; Hono/Koa is \`(c, next)\` (2 params,
    // first is the context). Both use \`await next()\` to pass
    // through, NOT \`next(error)\` to forward errors. The
    // not-calling-next(error) signal doesn't apply.
    if (paramNames.length === 2) return null
    if (paramNames[0] === 'c' || paramNames[0] === 'ctx' ||
        paramNames[0] === 'context') return null

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
