import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES, getFunctionBody, getFunctionName } from './_helpers.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

export const identicalFunctionsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/identical-functions',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    const bodies: Array<{ body: string; fnNode: SyntaxNode }> = []

    function walk(n: SyntaxNode) {
      if (JS_FUNCTION_TYPES.includes(n.type)) {
        // Skip functions used as inline call-site values — argument to a call
        // (e.g. Drizzle column defs), value in an object-literal property bag
        // (mutation/option-bag callbacks like `onSuccess: () => {...}`), or a
        // JSX attribute expression. Identical bodies at distinct call sites
        // are glue, not duplicated logic worth extracting.
        const parentType = n.parent?.type
        if (
          parentType === 'arguments' ||
          parentType === 'pair' ||
          parentType === 'jsx_expression'
        ) { return }
        const body = getFunctionBody(n)
        // Skip concise-body arrows (`(x) => expr`): these are by definition
        // single-expression lambdas — typically trivial event handlers or
        // prop adapters where identical text is JSX boilerplate, not
        // duplicated logic worth extracting.
        const isConciseArrow = n.type === 'arrow_function' && body !== null && body.type !== 'statement_block'
        if (body && body.namedChildCount > 0 && !isConciseArrow) {
          const normalized = body.text.replace(/\s+/g, ' ').trim()
          bodies.push({ body: normalized, fnNode: n })
        }
        if (body) {
          for (let i = 0; i < body.childCount; i++) {
            const child = body.child(i)
            if (child) walk(child)
          }
        }
        return
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(node)

    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        if (bodies[i].body === bodies[j].body && bodies[i].body.length > 10) {
          const nameA = getFunctionName(bodies[i].fnNode)
          const nameB = getFunctionName(bodies[j].fnNode)
          return makeViolation(
            this.ruleKey, bodies[i].fnNode, filePath, 'medium',
            'Identical function bodies',
            `Functions \`${nameA}\` and \`${nameB}\` have identical bodies. Extract to a shared function.`,
            sourceCode,
            'Extract the shared logic into a helper function and call it from both places.',
          )
        }
      }
    }
    return null
  },
}
