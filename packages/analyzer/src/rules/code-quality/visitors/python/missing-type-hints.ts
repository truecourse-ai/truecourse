import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('web-tree-sitter').Node

function isPublicFunction(node: SyntaxNode): boolean {
  const name = node.childForFieldName('name')?.text ?? ''
  // Only check public functions (not starting with _)
  // Skip __init__ and dunder methods
  return !name.startsWith('_')
}

function paramHasType(param: SyntaxNode): boolean {
  // typed_parameter has an explicit type annotation
  return param.type === 'typed_parameter' || param.type === 'typed_default_parameter'
}

function hasReturnType(node: SyntaxNode): boolean {
  // Return type annotation: def foo() -> Type:
  return node.childForFieldName('return_type') !== null
}

export const pythonMissingTypeHintsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/missing-type-hints',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    if (!isPublicFunction(node)) return null

    const params = node.childForFieldName('parameters')
    if (!params) return null

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text ?? 'function'

    const paramList = params.namedChildren.filter((p) =>
      p.type === 'identifier' ||
      p.type === 'typed_parameter' ||
      p.type === 'default_parameter' ||
      p.type === 'typed_default_parameter',
    )

    // Skip if function only has self parameter
    const nonSelfParams = paramList.filter((p) => {
      const pName = p.type === 'identifier' ? p.text : p.namedChildren[0]?.text
      return pName !== 'self' && pName !== 'cls'
    })

    // Count parameters missing type hints
    const untypedParams = nonSelfParams.filter((p) => !paramHasType(p))
    const missingReturn = !hasReturnType(node)

    if (untypedParams.length === 0 && !missingReturn) return null

    const issues: string[] = []
    if (untypedParams.length > 0) {
      const names = untypedParams.map((p) =>
        p.type === 'identifier' ? p.text : p.namedChildren[0]?.text ?? '?',
      )
      issues.push(`parameters without type hints: ${names.map((n) => `\`${n}\``).join(', ')}`)
    }
    if (missingReturn) issues.push('missing return type annotation')

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Missing type hints',
      `Function \`${name}\` has ${issues.join(' and ')}. Type hints improve IDE support, documentation, and catch errors early.`,
      sourceCode,
      'Add type annotations to all parameters and the return type.',
    )
  },
}
