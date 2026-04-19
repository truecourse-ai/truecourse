import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { ARRAY_METHODS_REQUIRING_RETURN, JS_LANGUAGES } from './_helpers.js'

export const arrayCallbackReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/array-callback-return',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Look for .map(...), .filter(...), etc.
    if (fn.type !== 'member_expression') return null
    const prop = fn.childForFieldName('property')
    if (!prop || !ARRAY_METHODS_REQUIRING_RETURN.has(prop.text)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // The callback must be arrow_function, function, or function_expression
    if (firstArg.type !== 'arrow_function' && firstArg.type !== 'function' && firstArg.type !== 'function_expression') return null

    const body = firstArg.childForFieldName('body')
    if (!body) return null

    // If the body is not a statement_block (i.e. it's an expression body), it has an implicit return
    if (body.type !== 'statement_block') return null

    // Check if there's any return statement with a value
    function hasReturn(n: SyntaxNode): boolean {
      if (n.type === 'return_statement' && n.namedChildren.length > 0) return true
      // Don't recurse into nested functions
      if (n.type === 'function_declaration' || n.type === 'arrow_function' || n.type === 'function') return false
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && hasReturn(child)) return true
      }
      return false
    }

    if (!hasReturn(body)) {
      return makeViolation(
        this.ruleKey, firstArg, filePath, 'high',
        'Array callback missing return',
        `Callback for \`${prop.text}()\` has no return statement — it will always return \`undefined\`.`,
        sourceCode,
        `Add a return statement to the \`${prop.text}\` callback.`,
      )
    }

    return null
  },
}
