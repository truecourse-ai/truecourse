import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: @app.get('/...', response_model=SomeType) where function has -> SomeType annotation
// The response_model is redundant when it matches the return type annotation

function getResponseModel(decoratorText: string): string | null {
  const match = decoratorText.match(/response_model\s*=\s*([^,)\s]+)/)
  return match ? match[1].trim() : null
}

function getReturnAnnotation(funcNode: SyntaxNode): string | null {
  const returnType = funcNode.childForFieldName('return_type')
  if (!returnType) return null
  return returnType.text.replace(/^->\s*/, '').trim()
}

function isFastAPIDecorator(text: string): boolean {
  return !!(text.match(/\.(get|post|put|patch|delete|options|head|route)\s*\(/) ||
    text.match(/(router|app|api)\.(get|post|put|patch|delete|options|head|route)\s*\(/))
}

export const pythonFastapiRedundantResponseModelVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/fastapi-redundant-response-model',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const parent = node.parent
    if (!parent || parent.type !== 'decorated_definition') return null

    let responseModel: string | null = null

    for (const child of parent.namedChildren) {
      if (child.type !== 'decorator') continue
      if (!isFastAPIDecorator(child.text)) continue
      responseModel = getResponseModel(child.text)
      if (responseModel) break
    }

    if (!responseModel) return null

    const returnAnnotation = getReturnAnnotation(node)
    if (!returnAnnotation) return null

    if (responseModel === returnAnnotation) {
      const nameNode = node.childForFieldName('name')
      return makeViolation(
        this.ruleKey, nameNode ?? node, filePath, 'low',
        'FastAPI redundant response_model',
        `\`response_model=${responseModel}\` is redundant — the function already has \`-> ${returnAnnotation}\` return type annotation. FastAPI uses the return annotation automatically.`,
        sourceCode,
        'Remove the `response_model` argument from the decorator.',
      )
    }
    return null
  },
}
