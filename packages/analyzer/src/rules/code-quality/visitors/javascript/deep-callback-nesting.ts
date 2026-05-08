import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const deepCallbackNestingVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/deep-callback-nesting',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_expression', 'arrow_function'],
  visit(node, filePath, sourceCode) {
    let depth = 0
    let parent = node.parent
    let insideJsxExpression = false
    let prevWasMethodChainArguments = false
    let prevCallNode: typeof parent = null

    while (parent) {
      if (parent.type === 'jsx_expression') {
        insideJsxExpression = true
      }

      if (parent.type === 'arguments') {
        // Don't double-count consecutive method-chain arguments
        // produced by `a.b(x).c(y).d(z)` — each link in the chain
        // adds an `arguments` parent on the way up, but the chain
        // is a single horizontal flow, not vertical nesting. We
        // count one level per distinct `call_expression` whose
        // function isn't a chained member access of the prior
        // call's result.
        const callNode = parent.parent
        const isChainContinuation =
          prevCallNode != null &&
          callNode?.type === 'call_expression' &&
          (() => {
            const fn = callNode.childForFieldName('function')
            if (fn?.type !== 'member_expression') return false
            // The receiver of this method call is the previous call
            // (i.e., `prev.then(...)`, `prev.map(...).filter(...)`).
            const obj = fn.childForFieldName('object')
            return obj?.id === prevCallNode.id
          })()
        if (!isChainContinuation) {
          depth++
        }
        prevCallNode = callNode
        prevWasMethodChainArguments = true
      } else {
        prevWasMethodChainArguments = false
      }

      if ((parent.type === 'function_declaration') || parent.type === 'program') break

      parent = parent.parent
    }

    // Threshold: 4 in normal code, 5 when the entire chain lives
    // inside a JSX prop expression (event handlers, render props
    // — JSX-heavy components legitimately reach depth 4 via
    // `<Form><Field render={f => fn(items.map(...))} /></Form>`).
    const threshold = insideJsxExpression ? 5 : 4
    if (depth >= threshold) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Deep callback nesting',
        `Callback nested ${depth} levels deep — refactor using async/await or named functions.`,
        sourceCode,
        'Extract nested callbacks into named functions or use async/await to flatten the nesting.',
      )
    }
    void prevWasMethodChainArguments
    return null
  },
}
