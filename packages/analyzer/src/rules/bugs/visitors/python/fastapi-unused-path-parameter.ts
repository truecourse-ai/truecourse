import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: @app.get('/users/{user_id}') where function doesn't have user_id parameter

function extractPathParams(decoratorText: string): string[] {
  const params: string[] = []
  const re = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(decoratorText)) !== null) {
    params.push(m[1])
  }
  return params
}

function getFunctionParamNames(funcNode: SyntaxNode): Set<string> {
  const params = new Set<string>()
  const parameters = funcNode.childForFieldName('parameters')
  if (!parameters) return params

  for (const child of parameters.namedChildren) {
    if (child.type === 'identifier') {
      params.add(child.text)
    } else if (
      child.type === 'default_parameter' ||
      child.type === 'typed_parameter' ||
      child.type === 'typed_default_parameter'
    ) {
      // typed_parameter: identifier : type
      // Try childForFieldName first, fall back to first identifier child
      const nameNode = child.childForFieldName('name') ?? child.namedChildren.find(c => c.type === 'identifier')
      if (nameNode) params.add(nameNode.text)
    }
  }
  return params
}

function isFastAPIDecorator(text: string): boolean {
  return !!(text.match(/\.(get|post|put|patch|delete|options|head|route)\s*\(/) ||
    text.match(/(router|app|api)\.(get|post|put|patch|delete|options|head|route)\s*\(/))
}

export const pythonFastapiUnusedPathParameterVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/fastapi-unused-path-parameter',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const parent = node.parent
    if (!parent || parent.type !== 'decorated_definition') return null

    const pathParams: string[] = []

    for (const child of parent.namedChildren) {
      if (child.type !== 'decorator') continue
      if (!isFastAPIDecorator(child.text)) continue
      pathParams.push(...extractPathParams(child.text))
    }

    if (pathParams.length === 0) return null

    const funcParams = getFunctionParamNames(node)
    const missing = pathParams.filter(p => !funcParams.has(p))

    if (missing.length > 0) {
      const nameNode = node.childForFieldName('name')
      return makeViolation(
        this.ruleKey, nameNode ?? node, filePath, 'high',
        'FastAPI path parameter not in function',
        `Path parameter${missing.length > 1 ? 's' : ''} \`${missing.join('`, `')}\` ${missing.length > 1 ? 'are' : 'is'} defined in the route but not present in function \`${nameNode?.text ?? ''}\`'s signature.`,
        sourceCode,
        `Add \`${missing.join(', ')}\` to the function parameters.`,
      )
    }
    return null
  },
}
