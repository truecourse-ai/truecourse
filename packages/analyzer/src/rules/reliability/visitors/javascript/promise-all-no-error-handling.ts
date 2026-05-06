import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isInsideTryCatch, hasCatchChain } from './_helpers.js'

export const promiseAllNoErrorHandlingVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/promise-all-no-error-handling',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Match Promise.all(), Promise.allSettled() is fine
    if (fn.type !== 'member_expression') return null
    const obj = fn.childForFieldName('object')
    const prop = fn.childForFieldName('property')
    if (obj?.text !== 'Promise' || prop?.text !== 'all') return null

    // Check if inside try/catch or has .catch() chain
    if (isInsideTryCatch(node)) return null
    if (hasCatchChain(node)) return null

    // Check if result is awaited inside try/catch
    const parent = node.parent
    if (parent?.type === 'await_expression' && isInsideTryCatch(parent)) return null

    // Skip when the Promise.all is RETURNED to the caller — the caller
    // takes ownership of error handling. Covers explicit return, return-await,
    // and implicit-return arrow bodies.
    if (parent?.type === 'return_statement') return null
    if (parent?.type === 'arrow_function') return null
    if (parent?.type === 'await_expression') {
      const grandParent = parent.parent
      if (grandParent?.type === 'return_statement') return null
      if (grandParent?.type === 'arrow_function') return null
    }

    // Skip when `await Promise.all(...)` is inside an `async` function —
    // the await re-throws on rejection, which propagates to the caller's
    // try/catch via the function's returned Promise. The rule's intent is
    // catching fire-and-forget promises, not async functions whose error
    // path is the standard await-propagation chain.
    if (parent?.type === 'await_expression') {
      let asyncAncestor: import('web-tree-sitter').Node | null = parent.parent
      while (asyncAncestor) {
        if (
          asyncAncestor.type === 'function_declaration' ||
          asyncAncestor.type === 'arrow_function' ||
          asyncAncestor.type === 'function_expression' ||
          asyncAncestor.type === 'method_definition' ||
          asyncAncestor.type === 'function'
        ) {
          // Tree-sitter records the `async` keyword as a leading child
          // (or in the function's text prefix). Detecting it via
          // text-prefix is the simplest stable check.
          if (asyncAncestor.text.startsWith('async ') || asyncAncestor.text.startsWith('async(')) return null
          break
        }
        asyncAncestor = asyncAncestor.parent
      }
    }

    // Skip framework-managed routes where the framework catches thrown
    // errors and renders an error boundary / 500 response:
    //   - Next.js app router: page.tsx, layout.tsx, route.ts(x)
    //   - Remix: anything under app/routes/
    if (/\/app\/.*(?:page|layout|route)\.[tj]sx?$/.test(filePath)) return null
    if (/\/app\/routes\//.test(filePath)) return null

    // Skip shutdown/teardown/cleanup functions — errors during shutdown are typically acceptable
    let ancestor: import('web-tree-sitter').Node | null = node.parent
    while (ancestor) {
      if (
        ancestor.type === 'function_declaration' ||
        ancestor.type === 'method_definition' ||
        ancestor.type === 'arrow_function' ||
        ancestor.type === 'function_expression'
      ) {
        const nameNode = ancestor.childForFieldName('name')
        const funcName = nameNode?.text?.toLowerCase() ?? ''
        // For arrow_function/function_expression, check if the variable declarator has a name
        if (!funcName && (ancestor.type === 'arrow_function' || ancestor.type === 'function_expression')) {
          const parentDecl = ancestor.parent
          if (parentDecl?.type === 'variable_declarator') {
            const varName = parentDecl.childForFieldName('name')?.text?.toLowerCase() ?? ''
            if (varName.includes('shutdown') || varName.includes('teardown') || varName.includes('cleanup')) return null
          }
        }
        if (funcName.includes('shutdown') || funcName.includes('teardown') || funcName.includes('cleanup')) return null
        break
      }
      ancestor = ancestor.parent
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Promise.all without error handling',
      'Promise.all() will reject if any promise rejects. Add .catch() or wrap in try/catch.',
      sourceCode,
      'Add a .catch() handler or wrap the Promise.all() in a try/catch block.',
    )
  },
}
