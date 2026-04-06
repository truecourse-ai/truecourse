import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const unnecessaryPromiseWrapVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-promise-wrap',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['new_expression'],
  visit(node, filePath, sourceCode) {
    const ctor = node.childForFieldName('constructor')
    if (!ctor || ctor.text !== 'Promise') return null

    const args = node.childForFieldName('arguments')
    if (!args || args.namedChildCount !== 1) return null

    const executor = args.namedChildren[0]
    if (!executor) return null
    if (executor.type !== 'arrow_function' && executor.type !== 'function_expression') return null

    // Get first parameter name — handles both:
    // (resolve) => ... (formal_parameters with identifier inside)
    // resolve => ...  (identifier directly as parameter field)
    let resolveName: string | null = null
    let hasRejectParam = false

    const formalParams = executor.childForFieldName('parameters')
    if (formalParams) {
      // Function expression or arrow with parens: (resolve, reject?) => ...
      if (formalParams.namedChildCount >= 2) hasRejectParam = true
      const firstParam = formalParams.namedChild(0)
      resolveName = firstParam?.text ?? null
    } else {
      // Single-param arrow without parens: resolve => ...
      // The parameter is the 'parameter' field or the first named child before '=>'
      const paramNode = executor.childForFieldName('parameter')
      if (paramNode) {
        resolveName = paramNode.text
      } else {
        // Fallback: first named child that is an identifier
        for (let i = 0; i < executor.namedChildCount; i++) {
          const child = executor.namedChild(i)
          if (child?.type === 'identifier') {
            resolveName = child.text
            break
          }
        }
      }
    }

    if (!resolveName || hasRejectParam) return null

    const body = executor.childForFieldName('body')
    if (!body) return null

    // Check: body is a single call_expression invoking `resolve(x)` or
    // body is a statement_block with a single expression_statement that calls resolve(x)
    function isSimpleResolveCall(n: import('tree-sitter').SyntaxNode): boolean {
      if (n.type === 'call_expression') {
        const fn = n.childForFieldName('function')
        return fn?.text === resolveName
      }
      if (n.type === 'statement_block') {
        const stmts = n.namedChildren
        if (stmts.length === 1 && stmts[0].type === 'expression_statement') {
          return isSimpleResolveCall(stmts[0].namedChildren[0])
        }
      }
      return false
    }

    if (isSimpleResolveCall(body)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Unnecessary Promise wrapper',
        '`new Promise(resolve => resolve(x))` can be simplified to `Promise.resolve(x)`.',
        sourceCode,
        'Replace with `Promise.resolve(value)`.',
      )
    }
    return null
  },
}
