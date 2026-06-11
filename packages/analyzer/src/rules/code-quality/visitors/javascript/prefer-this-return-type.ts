import type { Node as SyntaxNode } from 'web-tree-sitter'
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
      // Only flag methods that actually `return this`. A method annotated
      // with the class name but returning a *freshly-constructed* instance
      // (a factory / clone / child-context builder) is correctly typed —
      // the value handed back is a different object, so `this` would be
      // wrong. The `this`-return suggestion only applies to fluent methods
      // that hand back the receiver for chaining.
      if (!methodReturnsThis(node)) return null

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

/**
 * True when the method body contains at least one `return this` statement
 * (the bare receiver), not crossing into nested function scopes. Returning
 * `this.something` or a freshly-built instance does not count.
 */
function methodReturnsThis(method: SyntaxNode): boolean {
  const body = method.childForFieldName('body')
  if (!body) return false

  let found = false
  function walk(n: SyntaxNode): void {
    if (found) return
    // Don't descend into nested function scopes — their `return this`
    // refers to a different receiver.
    if (n.id !== body!.id && (n.type === 'function_declaration'
      || n.type === 'function_expression' || n.type === 'arrow_function'
      || n.type === 'method_definition')) {
      return
    }
    if (n.type === 'return_statement') {
      const arg = n.namedChildren[0]
      if (arg?.type === 'this') {
        found = true
        return
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i)
      if (child) walk(child)
    }
  }
  walk(body)
  return found
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
