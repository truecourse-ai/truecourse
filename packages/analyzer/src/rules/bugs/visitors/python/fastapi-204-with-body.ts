import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonDecoratorName } from '../../../_shared/python-helpers.js'

// Detect: @app.get('/...', status_code=204) with non-None response_model or return value

const HTTP_METHOD_NAMES = new Set(['route', 'get', 'post', 'put', 'patch', 'delete', 'options', 'head'])

/** Walk the decorator's call arguments for `keyword_argument` nodes. */
function getDecoratorCallArgs(decorator: SyntaxNode): SyntaxNode[] {
  const inner = decorator.namedChildren[0]
  if (!inner) return []
  // If the decorator expression is a call (e.g. @app.get('/...', status_code=204))
  const call = inner.type === 'call' ? inner : null
  if (!call) return []
  const args = call.childForFieldName('arguments')
  if (!args) return []
  return args.namedChildren.filter((c) => c.type === 'keyword_argument')
}

function has204StatusCode(decorator: SyntaxNode): boolean {
  for (const kwarg of getDecoratorCallArgs(decorator)) {
    const name = kwarg.childForFieldName('name')
    const value = kwarg.childForFieldName('value')
    if (name?.text === 'status_code' && value?.text === '204') return true
  }
  return false
}

function hasResponseBody(decorator: SyntaxNode): boolean {
  for (const kwarg of getDecoratorCallArgs(decorator)) {
    const name = kwarg.childForFieldName('name')
    const value = kwarg.childForFieldName('value')
    if (name?.text === 'response_model' && value?.text !== 'None') return true
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
      const termName = getPythonDecoratorName(child)
      if (!termName || !HTTP_METHOD_NAMES.has(termName)) continue

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
