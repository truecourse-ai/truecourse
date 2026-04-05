import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

function hasDependsCall(defaultValue: SyntaxNode): boolean {
  if (defaultValue.type === 'call') {
    const fn = defaultValue.childForFieldName('function')
    if (!fn) return false
    if (fn.type === 'identifier' && fn.text === 'Depends') return true
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      return attr?.text === 'Depends'
    }
  }
  return false
}

function isAnnotatedType(annotation: SyntaxNode): boolean {
  // Annotated[type, Depends(...)]
  if (annotation.type === 'subscript') {
    const value = annotation.childForFieldName('value')
    return value?.text === 'Annotated'
  }
  return false
}

export const pythonFastapiNonAnnotatedDependencyVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/fastapi-non-annotated-dependency',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const params = node.childForFieldName('parameters')
    if (!params) return null

    for (const param of params.namedChildren) {
      if (param.type === 'default_parameter' || param.type === 'typed_default_parameter') {
        const defaultValue = param.childForFieldName('value')
        if (!defaultValue || !hasDependsCall(defaultValue)) continue

        const annotation = param.childForFieldName('type')
        if (!annotation || !isAnnotatedType(annotation)) {
          const nameNode = param.namedChildren[0]
          const paramName = nameNode?.text ?? 'param'
          return makeViolation(
            this.ruleKey, param, filePath, 'low',
            'FastAPI non-annotated dependency',
            `Parameter \`${paramName}\` uses \`Depends()\` but is not wrapped in \`Annotated[type, Depends(...)]\`. The modern FastAPI pattern uses \`Annotated\` for better tooling support.`,
            sourceCode,
            `Change to \`${paramName}: Annotated[YourType, Depends(your_dep)]\` and import \`Annotated\` from \`typing\`.`,
          )
        }
      }
    }

    return null
  },
}
