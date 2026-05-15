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

    // Must have a next-like param at position ≥2 (Express signature is (req, res, next, ...)
    // or (err, req, res, next)). Hono middleware uses (c, next) where next is callable
    // without arguments — that's a fundamentally different middleware contract, not the
    // Express next(error) pattern this rule targets.
    const nextIdx = paramNames.indexOf('next')
    if (nextIdx < 2) return null

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
