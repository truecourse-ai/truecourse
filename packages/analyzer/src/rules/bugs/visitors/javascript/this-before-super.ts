import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const thisBeforeSuperVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/this-before-super',
  languages: JS_LANGUAGES,
  nodeTypes: ['class_declaration', 'class'],
  visit(node, filePath, sourceCode) {
    const heritage = node.childForFieldName('heritage') || node.children.find((c) => c.type === 'class_heritage')
    if (!heritage) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    let constructor: SyntaxNode | null = null
    for (const member of body.namedChildren) {
      if (member.type === 'method_definition') {
        const name = member.childForFieldName('name')
        if (name?.text === 'constructor') {
          constructor = member
          break
        }
      }
    }
    if (!constructor) return null

    const ctorBody = constructor.childForFieldName('body')
    if (!ctorBody) return null

    // Walk statements in order, find first `this` usage and first `super()` call
    let foundSuper = false
    function checkThisBeforeSuper(n: SyntaxNode): SyntaxNode | null {
      if (n.type === 'call_expression') {
        const fn = n.childForFieldName('function')
        if (fn?.type === 'super') {
          foundSuper = true
          return null
        }
      }
      if (n.type === 'this' && !foundSuper) {
        return n
      }
      if (n.type === 'function_declaration' || n.type === 'arrow_function' || n.type === 'function') return null
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) {
          const found = checkThisBeforeSuper(child)
          if (found) return found
        }
      }
      return null
    }

    const thisNode = checkThisBeforeSuper(ctorBody)
    if (thisNode) {
      return makeViolation(
        this.ruleKey, thisNode, filePath, 'high',
        'This before super',
        '`this` is used before `super()` is called in a derived constructor, which causes a ReferenceError.',
        sourceCode,
        'Move `super()` before any `this` usage.',
      )
    }
    return null
  },
}
