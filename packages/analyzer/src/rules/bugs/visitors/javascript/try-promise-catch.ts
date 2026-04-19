import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// Detects: await expression inside try/catch where a Promise is used
// try { await promise } catch — legitimate pattern, but
// specifically flagging: try { promise.then(...) } without catch on promise itself
// Simplified: detect new Promise(...) or promise chain in try block without await
export const tryPromiseCatchVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/try-promise-catch',
  languages: JS_LANGUAGES,
  nodeTypes: ['try_statement'],
  visit(node, filePath, sourceCode) {
    const tryBody = node.namedChildren.find((c) => c.type === 'statement_block')
    if (!tryBody) return null

    const hasCatch = node.namedChildren.some((c) => c.type === 'catch_clause')
    if (!hasCatch) return null

    // Find promise chains (.then, .catch on non-awaited expressions) inside try block
    const unawaited = findUnawaitedPromise(tryBody)
    if (!unawaited) return null

    return makeViolation(
      this.ruleKey, unawaited, filePath, 'medium',
      'Promise in try block without await',
      'Promise rejection is not caught by `try/catch` unless the promise is `await`ed — use `await` or handle rejections via `.catch()`.',
      sourceCode,
      'Add `await` before the promise, or use `.catch()` on the promise to handle rejections.',
    )
  },
}

function findUnawaitedPromise(node: import('web-tree-sitter').Node): import('web-tree-sitter').Node | null {
  for (const child of node.namedChildren) {
    if (child.type === 'expression_statement') {
      const expr = child.namedChildren[0]
      if (!expr) continue

      // Look for call expressions like promise.then(...) that are not awaited
      if (expr.type === 'call_expression') {
        const func = expr.childForFieldName('function')
        if (func?.type === 'member_expression') {
          const prop = func.childForFieldName('property')
          if (prop?.text === 'then' || prop?.text === 'catch') {
            // Check parent is not await
            return expr
          }
        }
      }

      // new Promise(...) not awaited
      if (expr.type === 'new_expression') {
        const constructor = expr.namedChildren[0]
        if (constructor?.text === 'Promise') {
          return expr
        }
      }
    }
  }
  return null
}
