import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

/**
 * Detects class methods that don't use `this` and could be static.
 * Skips constructors, methods with decorators, and overridden methods.
 */
export const staticMethodCandidateVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/static-method-candidate',
  languages: JS_LANGUAGES,
  nodeTypes: ['method_definition'],
  visit(node, filePath, sourceCode) {
    // Only flag methods inside class bodies, not object literal methods (Proxy handlers, etc.)
    if (node.parent?.type !== 'class_body') return null

    // Skip methods in classes that extend or implement — they may be overriding base class methods
    const classNode = node.parent?.parent
    if (classNode) {
      for (let i = 0; i < classNode.childCount; i++) {
        const child = classNode.child(i)
        if (child && (child.type === 'class_heritage' || child.type === 'extends_clause' || child.type === 'implements_clause')) return null
      }
      // Also check for extends/implements keywords directly in the class text before the body
      const classText = classNode.text
      const bodyStart = classNode.childForFieldName('body')
      if (bodyStart) {
        const preamble = classText.slice(0, bodyStart.startIndex - classNode.startIndex)
        if (/\b(extends|implements)\b/.test(preamble)) return null
      }
    }

    // Skip constructors
    const nameNode = node.childForFieldName('name')
    if (!nameNode) return null
    const name = nameNode.text
    if (name === 'constructor') return null

    // Skip if already static
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child && child.type === 'static') return null
    }

    // Skip getters and setters
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child && (child.type === 'get' || child.type === 'set')) return null
    }

    // Skip abstract methods (no body)
    const body = node.childForFieldName('body')
    if (!body) return null

    // Skip empty methods
    const statements = body.namedChildren
    if (statements.length === 0) return null

    // Skip if method has decorators (check previous sibling)
    const prev = node.previousNamedSibling
    if (prev && prev.type === 'decorator') return null

    // Check if `this` or `super` is used in the body
    if (usesThisOrSuper(body)) return null

    // Skip universal Object.prototype methods that are intentional overrides.
    // Framework lifecycle methods (React, Vue, Angular, Svelte) are already
    // handled by the heritage check above — those classes always extend a
    // framework base class. The previous list hardcoded React-specific names
    // and missed Vue's `mounted`, Angular's `ngOnInit`, etc.
    const universalContractMethods = new Set([
      'toString', 'valueOf', 'toJSON',
    ])
    if (universalContractMethods.has(name)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Static method candidate',
      `Method '${name}' does not use 'this' — consider making it static or a standalone function.`,
      sourceCode,
      `Add the 'static' keyword or extract '${name}' as a standalone function.`,
    )
  },
}

function usesThisOrSuper(node: SyntaxNode): boolean {
  if (node.type === 'this' || node.type === 'super') return true

  // Don't recurse into nested functions/classes
  if (
    node.type === 'function_declaration' ||
    node.type === 'function_expression' ||
    node.type === 'arrow_function' ||
    node.type === 'class_declaration' ||
    node.type === 'class'
  ) return false

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && usesThisOrSuper(child)) return true
  }
  return false
}
