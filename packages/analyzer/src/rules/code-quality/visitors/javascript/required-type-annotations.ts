import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects places where type annotations are required but missing.
 * Focuses on function parameters and return types for exported functions,
 * which is most valuable for API boundaries.
 */
export const requiredTypeAnnotationsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/required-type-annotations',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['export_statement'],
  visit(node, filePath, sourceCode) {
    // Only check exported declarations
    const declaration = node.namedChildren[0]
    if (!declaration) return null

    if (
      declaration.type === 'function_declaration' ||
      declaration.type === 'lexical_declaration'
    ) {
      return checkFunctionDeclaration(declaration, node, filePath, sourceCode, 'code-quality/deterministic/required-type-annotations')
    }

    return null
  },
}

function checkFunctionDeclaration(
  decl: SyntaxNode,
  reportNode: SyntaxNode,
  filePath: string,
  sourceCode: string,
  ruleKey: string,
): ReturnType<CodeRuleVisitor['visit']> {
  let fnNode: SyntaxNode | null = null

  if (decl.type === 'function_declaration') {
    fnNode = decl
  } else if (decl.type === 'lexical_declaration') {
    // const fn = (...) => {} or const fn = function() {}
    const declarator = decl.namedChildren.find((c) => c.type === 'variable_declarator')
    if (!declarator) return null
    const value = declarator.childForFieldName('value')
    if (value && (value.type === 'arrow_function' || value.type === 'function_expression' || value.type === 'function')) {
      fnNode = value
    }
  }

  if (!fnNode) return null

  const params = fnNode.childForFieldName('parameters')
  if (!params) return null

  // Check for unannotated parameters
  for (const param of params.namedChildren) {
    // In tree-sitter TypeScript, an untyped param may be 'identifier' or 'required_parameter'
    let paramName: string | null = null
    let hasTypeAnnotation = false

    if (param.type === 'identifier') {
      paramName = param.text
    } else if (param.type === 'required_parameter' || param.type === 'optional_parameter') {
      const nameNode = param.childForFieldName('pattern') ?? param.childForFieldName('name')
      if (nameNode) paramName = nameNode.text
      // Check if it has a type annotation
      const typeNode = param.childForFieldName('type')
      if (typeNode) hasTypeAnnotation = true
    }

    if (!paramName || hasTypeAnnotation) continue

    // Skip parameters with a default value — TypeScript infers the type from the initializer
    if (param.type === 'required_parameter' || param.type === 'optional_parameter') {
      const valueNode = param.childForFieldName('value')
      if (valueNode) continue
    }

    // Skip commonly understood parameter names
    if (['_', 'e', 'err', 'error', 'event', 'req', 'res', 'next'].includes(paramName)) continue

    return makeViolation(
      ruleKey, param, filePath, 'low',
      'Missing type annotation',
      `Exported function parameter '${paramName}' has no type annotation — add explicit types for API boundaries.`,
      sourceCode,
      `Add a type annotation to parameter '${paramName}'.`,
    )
  }

  // Check for missing return type on exported functions
  const returnType = fnNode.childForFieldName('return_type')
  if (!returnType) {
    const fnName = decl.type === 'function_declaration'
      ? decl.childForFieldName('name')?.text || 'anonymous'
      : decl.namedChildren.find((c) => c.type === 'variable_declarator')?.childForFieldName('name')?.text || 'anonymous'

    // Already checked by missing-return-type rule, skip to avoid duplication
    return null
  }

  return null
}
