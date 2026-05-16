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

    // Skip methods in classes that extend or implement — they may be overriding base class methods.
    // Also skip abstract classes (methods are polymorphic stubs for subclass override) and
    // singleton classes with a private constructor (instance methods are part of the singleton's
    // public API; converting to static breaks the singleton contract).
    const classNode = node.parent?.parent
    if (classNode) {
      for (let i = 0; i < classNode.childCount; i++) {
        const child = classNode.child(i)
        if (child && (child.type === 'class_heritage' || child.type === 'extends_clause' || child.type === 'implements_clause')) return null
      }
      // Also check for extends/implements/abstract keywords directly in the class text before the body.
      // `abstract class Foo { ... }` declares a base for subclass override — methods that throw
      // 'Not implemented' or provide no-op defaults are intentional override placeholders.
      const classText = classNode.text
      const bodyStart = classNode.childForFieldName('body')
      if (bodyStart) {
        const preamble = classText.slice(0, bodyStart.startIndex - classNode.startIndex)
        if (/\b(extends|implements|abstract)\b/.test(preamble)) return null
      }
      // Skip singleton-pattern classes: any class declaring a `private constructor()` is
      // controlled via a static factory (e.g. getInstance()). Instance methods on such
      // classes are part of the singleton API contract — making them static would force
      // callers off the singleton handle.
      if (hasPrivateConstructor(node.parent)) return null
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

  // Don't recurse into nested functions/classes that rebind `this`.
  // Arrow functions DO NOT rebind `this` — they inherit the enclosing method's
  // `this`, so a `this.foo` access inside a Promise wrapper or callback (e.g.
  // `new Promise(resolve => this.$canvas.toBlob(...))`) still counts as the
  // method using `this`.
  if (
    node.type === 'function_declaration' ||
    node.type === 'function_expression' ||
    node.type === 'generator_function_declaration' ||
    node.type === 'generator_function' ||
    node.type === 'method_definition' ||
    node.type === 'class_declaration' ||
    node.type === 'class'
  ) return false

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && usesThisOrSuper(child)) return true
  }
  return false
}

/**
 * Detect if a class body contains a `private constructor()` declaration.
 * This is the canonical signal for the singleton pattern: callers must go
 * through a static factory, and instance methods exist to expose the
 * singleton's API rather than to operate on per-instance state.
 */
function hasPrivateConstructor(classBody: SyntaxNode): boolean {
  for (let i = 0; i < classBody.childCount; i++) {
    const member = classBody.child(i)
    if (!member || member.type !== 'method_definition') continue
    const nameNode = member.childForFieldName('name')
    if (nameNode?.text !== 'constructor') continue
    // Look for an `accessibility_modifier` child with text `private`.
    for (let j = 0; j < member.childCount; j++) {
      const mod = member.child(j)
      if (mod && mod.type === 'accessibility_modifier' && mod.text === 'private') return true
    }
    // Fallback: scan the leading text before the `constructor` name token for `private`.
    const lead = member.text.slice(0, (nameNode.startIndex - member.startIndex))
    if (/\bprivate\b/.test(lead)) return true
  }
  return false
}
