import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonFlaskErrorHandlerVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/flask-error-handler-missing-status',
  languages: ['python'],
  nodeTypes: ['decorated_definition'],
  visit(node, filePath, sourceCode) {
    // Look for @app.errorhandler(...)
    const decorators = node.namedChildren.filter((c) => c.type === 'decorator')
    let isErrorHandler = false
    for (const dec of decorators) {
      const decText = dec.text
      if (decText.includes('errorhandler')) {
        isErrorHandler = true
        break
      }
    }
    if (!isErrorHandler) return null

    const funcDef = node.namedChildren.find((c) => c.type === 'function_definition')
    if (!funcDef) return null

    const body = funcDef.childForFieldName('body')
    if (!body) return null

    const bodyText = body.text

    // Check if the return statement includes a status code (tuple return)
    // Flask error handlers should return (response, status_code) or jsonify(...), status_code
    if (!bodyText.includes('return')) return null

    // Simple heuristic: check if the return has a comma (tuple) with a numeric status
    const returnStatements = body.namedChildren.filter((c) => c.type === 'return_statement')
    for (const ret of returnStatements) {
      const retText = ret.text
      // If it's a tuple return like return jsonify(...), 404 — that's fine
      if (retText.includes(',')) continue
      // If it returns make_response with status — fine
      if (retText.includes('make_response')) continue

      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Flask error handler missing status code',
        'Flask error handler returns a response without an explicit status code. The status will default to 200.',
        sourceCode,
        'Return a tuple: return response, status_code (e.g., return jsonify(error), 404).',
      )
    }

    return null
  },
}
