import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

const HOOK_NAMES = /^use[A-Z]/

// Check if a call is a React hook call
function isHookCall(node: SyntaxNode): boolean {
  if (node.type !== 'call_expression') return false
  const fn = node.childForFieldName('function')
  if (!fn) return false
  return HOOK_NAMES.test(fn.text)
}

// Check if the node is inside a conditional block (if/else/ternary/loop)
function getConditionalAncestor(node: SyntaxNode): SyntaxNode | null {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (
      current.type === 'if_statement' ||
      current.type === 'ternary_expression' ||
      current.type === 'for_statement' ||
      current.type === 'for_in_statement' ||
      current.type === 'for_of_statement' ||
      current.type === 'while_statement' ||
      current.type === 'do_statement'
    ) {
      return current
    }
    // Stop at function boundaries
    if (
      current.type === 'function_declaration' ||
      current.type === 'function_expression' ||
      current.type === 'arrow_function'
    ) {
      break
    }
    current = current.parent
  }
  return null
}

export const conditionalHookVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/conditional-hook',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    if (!isHookCall(node)) return null

    const conditionalAncestor = getConditionalAncestor(node)
    if (!conditionalAncestor) return null

    const fn = node.childForFieldName('function')
    const hookName = fn?.text ?? 'hook'

    return makeViolation(
      this.ruleKey, node, filePath, 'critical',
      'Hook called conditionally',
      `\`${hookName}\` is called inside a conditional or loop — this violates the Rules of Hooks. Hooks must be called unconditionally at the top level of a component.`,
      sourceCode,
      'Move the hook call to the top level of the component function, outside of any conditions or loops.',
    )
  },
}
