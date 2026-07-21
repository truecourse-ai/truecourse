import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * True if the enclosing function has an emptiness guard clause on the reduce
 * receiver — an `if` that tests `<receiver>.length` and early-exits
 * (`return` / `throw` / `break` / `continue`). e.g.
 *
 *   if (workers.length === 0) return;
 *   return workers.reduce((a, b) => …);   // ← safe: array is non-empty here
 *
 * A `reduce` without an initial value only throws on an *empty* array, so a
 * preceding length guard makes the missing initial value intentional, not a bug.
 */
function hasEmptinessGuard(node: SyntaxNode, receiver: string): boolean {
  let scope: SyntaxNode | null = node.parent
  while (scope) {
    if (
      scope.type === 'function_declaration' ||
      scope.type === 'function_expression' ||
      scope.type === 'arrow_function' ||
      scope.type === 'method_definition' ||
      scope.type === 'program'
    ) break
    scope = scope.parent
  }
  if (!scope) return false

  // `<receiver>.length` or `<receiver>?.length`, not a substring of another name.
  const lengthRef = new RegExp(`(^|[^\\w$.])${escapeRegExp(receiver)}(?:\\?\\.|\\.)length\\b`)

  let found = false
  function walk(n: SyntaxNode): void {
    if (found) return
    if (n.type === 'if_statement') {
      const cond = n.childForFieldName('condition')
      const cons = n.childForFieldName('consequence')
      if (
        cond && lengthRef.test(cond.text) &&
        cons && /\b(return|throw|break|continue)\b/.test(cons.text)
      ) {
        found = true
        return
      }
    }
    if (
      n !== scope &&
      (n.type === 'function_declaration' ||
        n.type === 'function_expression' ||
        n.type === 'arrow_function' ||
        n.type === 'method_definition')
    ) return
    for (let i = 0; i < n.childCount; i++) {
      const ch = n.child(i)
      if (ch) walk(ch)
    }
  }
  walk(scope)
  return found
}

export const reduceMissingInitialVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/reduce-missing-initial',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (!prop || (prop.text !== 'reduce' && prop.text !== 'reduceRight')) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argNodes = args.namedChildren
    // reduce(fn) — only one argument, no initial value
    if (argNodes.length === 1) {
      // Skip when the receiver array is guarded against emptiness above — a
      // length-check guard clause makes the missing initial value intentional.
      const receiver = fn.childForFieldName('object')
      if (receiver && hasEmptinessGuard(node, receiver.text)) return null

      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Array.reduce missing initial value',
        `\`${prop.text}()\` called without an initial value — throws TypeError on empty arrays.`,
        sourceCode,
        `Add an initial value as the second argument: \`.${prop.text}(fn, initialValue)\`.`,
      )
    }
    return null
  },
}
