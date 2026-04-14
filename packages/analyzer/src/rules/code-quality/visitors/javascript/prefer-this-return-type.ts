import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { TypeQueryService } from '../../../../ts-compiler.js'

/**
 * Detects methods that return the class type instead of `this`.
 * When a method returns `ClassName` instead of `this`, subclasses
 * lose the ability to chain calls — the type narrows to the parent.
 *
 * Uses TypeQueryService to get the actual return type and compare
 * it to the enclosing class name.
 */
export const preferThisReturnTypeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-this-return-type',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['method_definition'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery?: TypeQueryService) {
    if (!typeQuery) return null

    // Find the enclosing class
    const classNode = findEnclosingClass(node)
    if (!classNode) return null

    const className = classNode.childForFieldName('name')?.text
    if (!className) return null

    // Get the method name
    const methodName = node.childForFieldName('name')?.text
    if (!methodName) return null

    // Skip static methods — they don't benefit from `this` return type
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child?.type === 'static') return null
    }

    // Check the explicit return type annotation
    const returnTypeNode = node.childForFieldName('return_type')
    if (!returnTypeNode) return null

    // The return_type field in tree-sitter includes the `: ` prefix as a type_annotation node
    // Extract the actual type text
    const typeText = extractTypeText(returnTypeNode)
    if (!typeText) return null

    // Check if the return type annotation is exactly the class name
    if (typeText === className) {
      return makeViolation(
        this.ruleKey,
        returnTypeNode,
        filePath,
        'low',
        'Method should return `this` instead of class name',
        `Method \`${methodName}\` returns \`${className}\` but should return \`this\` to support subclass chaining.`,
        sourceCode,
        `Change the return type from \`${className}\` to \`this\`.`,
      )
    }

    return null
  },
}

function findEnclosingClass(node: SyntaxNode): SyntaxNode | null {
  let current = node.parent
  while (current) {
    if (current.type === 'class_declaration' || current.type === 'class') {
      return current
    }
    current = current.parent
  }
  return null
}

function extractTypeText(typeAnnotation: SyntaxNode): string | null {
  // type_annotation node usually wraps the actual type
  if (typeAnnotation.type === 'type_annotation') {
    // The child after `:` is the actual type
    for (const child of typeAnnotation.namedChildren) {
      return child.text
    }
  }
  return typeAnnotation.text
}
