import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const missingSuperCallVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/missing-super-call',
  languages: JS_LANGUAGES,
  nodeTypes: ['class_declaration', 'class'],
  visit(node, filePath, sourceCode) {
    // Check if this class has an extends clause
    const heritage = node.childForFieldName('heritage') || node.children.find((c) => c.type === 'class_heritage')
    if (!heritage) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Find the constructor
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

    // Check if super() is called
    function hasSuperCall(n: SyntaxNode): boolean {
      if (n.type === 'call_expression') {
        const fn = n.childForFieldName('function')
        if (fn?.type === 'super') return true
      }
      if (n.type === 'function_declaration' || n.type === 'arrow_function' || n.type === 'function') return false
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && hasSuperCall(child)) return true
      }
      return false
    }

    if (!hasSuperCall(ctorBody)) {
      return makeViolation(
        this.ruleKey, constructor, filePath, 'high',
        'Missing super call',
        'Constructor in a derived class must call `super()` before using `this`.',
        sourceCode,
        'Add `super()` at the beginning of the constructor.',
      )
    }
    return null
  },
}
