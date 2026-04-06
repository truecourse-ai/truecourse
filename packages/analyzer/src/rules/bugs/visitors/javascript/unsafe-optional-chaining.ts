import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const unsafeOptionalChainingVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unsafe-optional-chaining',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression', 'new_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function') || node.childForFieldName('constructor')
    if (!fn) return null

    // Check if the function/constructor expression contains optional chaining
    // Look for parenthesized_expression wrapping an optional chain
    function containsOptionalChain(n: SyntaxNode): boolean {
      if (n.type === 'member_expression' || n.type === 'subscript_expression' || n.type === 'call_expression') {
        // Check for ?. operator
        if (n.children.some((c) => c.text === '?.')) return true
      }
      if (n.type === 'optional_chain_expression') return true
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && containsOptionalChain(child)) return true
      }
      return false
    }

    if (fn.type === 'parenthesized_expression' && containsOptionalChain(fn)) {
      const kind = node.type === 'new_expression' ? 'constructor' : 'function call'
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unsafe optional chaining',
        `Optional chaining inside a parenthesized ${kind} can short-circuit to undefined, causing a runtime TypeError.`,
        sourceCode,
        'Remove the parentheses and use the optional chain directly, or add a null check.',
      )
    }
    return null
  },
}
