import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: request.args used inside a Flask route decorated with POST method

function isFlaskPostRoute(funcNode: SyntaxNode): boolean {
  // Look for @app.route('/...', methods=['POST']) or @blueprint.route(..., methods=['POST'])
  // decorators are siblings of the function in the decorated_definition parent
  let current: SyntaxNode | null = funcNode.parent
  if (!current || current.type !== 'decorated_definition') return false

  for (const child of current.namedChildren) {
    if (child.type !== 'decorator') continue
    const decoratorText = child.text
    if (!decoratorText.includes('route') && !decoratorText.includes('post')) continue
    if (decoratorText.includes('POST') || decoratorText.includes('"post"') || decoratorText.includes("'post'")) {
      return true
    }
    // @app.post(...) shorthand
    if (decoratorText.match(/\.(post|put|patch|delete)\s*\(/)) return true
  }
  return false
}

function usesRequestArgs(body: SyntaxNode): SyntaxNode | null {
  let found: SyntaxNode | null = null
  function walk(n: SyntaxNode) {
    if (found) return
    if (n.type === 'attribute') {
      const obj = n.childForFieldName('object')
      const attr = n.childForFieldName('attribute')
      if (obj?.text === 'request' && attr?.text === 'args') {
        found = n
        return
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }
  walk(body)
  return found
}

export const pythonFlaskQueryParamsInPostVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/flask-query-params-in-post',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    if (!isFlaskPostRoute(node)) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const argsUsage = usesRequestArgs(body)
    if (!argsUsage) return null

    return makeViolation(
      this.ruleKey, argsUsage, filePath, 'high',
      'Query parameters used in Flask POST handler',
      `\`request.args\` reads query string parameters — in a POST handler, form data is in \`request.form\` and JSON data is in \`request.get_json()\`.`,
      sourceCode,
      'Replace `request.args` with `request.form` for form data or `request.get_json()` for JSON.',
    )
  },
}
