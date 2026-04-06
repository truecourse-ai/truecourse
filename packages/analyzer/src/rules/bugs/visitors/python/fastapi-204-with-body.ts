import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: @app.get('/...', status_code=204) with non-None response_model or return value

function has204StatusCode(decorator: SyntaxNode): boolean {
  const text = decorator.text
  return text.includes('status_code=204') || text.includes('status_code = 204')
}

function hasResponseBody(decorator: SyntaxNode): boolean {
  const text = decorator.text
  // If there's a response_model= that's not None
  const match = text.match(/response_model\s*=\s*([^,)]+)/)
  if (match) {
    const model = match[1].trim()
    if (model !== 'None') return true
  }
  return false
}

export const pythonFastapi204WithBodyVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/fastapi-204-with-body',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const parent = node.parent
    if (!parent || parent.type !== 'decorated_definition') return null

    let has204 = false
    let hasBody = false

    for (const child of parent.namedChildren) {
      if (child.type !== 'decorator') continue
      const text = child.text
      if (!text.includes('route') && !text.match(/\.(get|post|put|patch|delete|options|head)\s*\(/)) continue

      if (has204StatusCode(child)) has204 = true
      if (hasResponseBody(child)) hasBody = true
    }

    if (has204 && hasBody) {
      const nameNode = node.childForFieldName('name')
      return makeViolation(
        this.ruleKey, nameNode ?? node, filePath, 'high',
        'FastAPI 204 response with body',
        `Endpoint \`${nameNode?.text ?? ''}\` returns HTTP 204 (No Content) but has a \`response_model\` — 204 responses must have empty bodies.`,
        sourceCode,
        'Remove the `response_model` or change the status code.',
      )
    }
    return null
  },
}
