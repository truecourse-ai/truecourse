import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: app.preprocess_request() called without using the return value
// The return value, if non-None, should short-circuit the request

export const pythonFlaskPreprocessReturnUnhandledVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/flask-preprocess-return-unhandled',
  languages: ['python'],
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr || expr.type !== 'call') return null

    const fn = expr.childForFieldName('function')
    if (!fn) return null

    // Match: app.preprocess_request() or app.full_dispatch_request() or similar
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr?.text === 'preprocess_request' || attr?.text === 'full_dispatch_request') {
        return makeViolation(
          this.ruleKey, expr, filePath, 'high',
          'Flask preprocess_request return not handled',
          `\`${fn.text}()\` return value is ignored — if it returns a response object (non-None), it should short-circuit the request handling.`,
          sourceCode,
          'Assign the return value and check if it is not None before proceeding.',
        )
      }
    }

    return null
  },
}
