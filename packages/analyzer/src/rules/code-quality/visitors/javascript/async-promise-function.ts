import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const asyncPromiseFunctionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/async-promise-function',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_declaration', 'function_expression', 'arrow_function', 'method_definition'],
  visit(node, filePath, sourceCode) {
    // Skip async functions — already fine
    const isAsync = node.children.some((c) => c.type === 'async' || c.text === 'async')
    if (isAsync) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Check if the function body contains a `return new Promise(...)` pattern
    function hasReturnNewPromise(n: import('tree-sitter').SyntaxNode): boolean {
      if (n.type === 'return_statement') {
        const ret = n.namedChildren[0]
        if (ret?.type === 'new_expression') {
          const ctor = ret.childForFieldName('constructor')
          if (ctor?.text === 'Promise') return true
        }
      }
      // Don't descend into nested functions
      if (n !== body && (n.type === 'function_declaration' || n.type === 'function_expression'
        || n.type === 'arrow_function' || n.type === 'method_definition')) return false
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && hasReturnNewPromise(child)) return true
      }
      return false
    }

    if (hasReturnNewPromise(body)) {
      const nameNode = node.childForFieldName('name')
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Non-async function returns new Promise',
        `Function \`${nameNode?.text ?? 'anonymous'}\` explicitly constructs a \`new Promise\` — mark it \`async\` and use \`await\` instead.`,
        sourceCode,
        'Mark the function `async` and replace `new Promise(...)` with `await`.',
      )
    }
    return null
  },
}
