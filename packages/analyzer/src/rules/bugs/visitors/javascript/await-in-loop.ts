import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

/**
 * `await reader.read()` is the canonical ReadableStream consumption
 * pattern. Returns `{value, done}` and the next call depends on the
 * previous's `done` bit — there is no fixed iteration set to
 * parallelise. Same for any `<X>.next()` async-iterator manual drive.
 */
function isStreamReadCall(node: SyntaxNode): boolean {
  // node is the await_expression; its argument is the actual call.
  const argument = node.namedChildren[0]
  if (!argument || argument.type !== 'call_expression') return false
  const fn = argument.childForFieldName('function')
  if (fn?.type !== 'member_expression') return false
  const property = fn.childForFieldName('property')
  return property?.text === 'read' || property?.text === 'next'
}

export const awaitInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/await-in-loop',
  languages: JS_LANGUAGES,
  nodeTypes: ['await_expression'],
  visit(node, filePath, sourceCode) {
    // `await stream.read()` / `await iterator.next()` — sequential by
    // protocol; no parallel alternative exists.
    if (isStreamReadCall(node)) return null

    // Walk up the tree to find if we're inside a loop
    let current: SyntaxNode | null = node.parent
    while (current) {
      const t = current.type
      if (t === 'for_statement' || t === 'for_in_statement' || t === 'while_statement' || t === 'do_statement') {
        // Make sure we're in the loop body (not the initializer/condition of a for loop)
        // and not inside a nested async function
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Await inside loop',
          '`await` inside a loop forces sequential execution of async operations. Consider collecting promises and using `Promise.all()` for parallel execution.',
          sourceCode,
          'Extract the async calls into an array and use `await Promise.all(promises)` outside the loop.',
        )
      }
      // Stop recursing if we hit a function boundary
      if (t === 'function_declaration' || t === 'arrow_function' || t === 'function' || t === 'method_definition') {
        break
      }
      current = current.parent
    }
    return null
  },
}
