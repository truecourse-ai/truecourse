import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_FUNCTION_BOUNDARIES, CSHARP_LOOP_TYPES, findInSameFunction, unwrapParens } from './_helpers.js'

const CANCELLATION_EXCEPTIONS = ['OperationCanceledException', 'TaskCanceledException']

/** while(true) / do…while(true) / for(;;) — a loop only cancellation can stop. */
function isUnconditionalLoop(loop: SyntaxNode): boolean {
  if (loop.type === 'for_statement') return loop.childForFieldName('condition') === null
  if (loop.type === 'while_statement' || loop.type === 'do_statement') {
    const condition = loop.childForFieldName('condition')
    return condition !== null && unwrapParens(condition).type === 'boolean_literal' && unwrapParens(condition).text === 'true'
  }
  return false
}

/**
 * `catch (OperationCanceledException)` swallowed inside an unconditional
 * worker loop: the loop can only stop via cancellation, but the catch eats
 * the exception and the loop spins forever — shutdown hangs.
 *
 * Catching OCE without rethrow OUTSIDE such loops is idiomatic graceful
 * shutdown and is never flagged.
 */
export const csharpCancellationExceptionNotReraisedVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/cancellation-exception-not-reraised',
  languages: ['csharp'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    const declaration = node.namedChildren.find((c) => c?.type === 'catch_declaration')
    const caughtType = declaration?.childForFieldName('type')?.text ?? ''
    if (!CANCELLATION_EXCEPTIONS.some((t) => caughtType === t || caughtType.endsWith(`.${t}`))) return null

    // An exception filter implies deliberate, conditional handling.
    if (node.namedChildren.some((c) => c?.type === 'catch_filter_clause')) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Re-raise or loop exit inside the catch body — handled correctly.
    const exits = findInSameFunction(body, (n) =>
      n.type === 'throw_statement' ||
      n.type === 'throw_expression' ||
      n.type === 'return_statement' ||
      n.type === 'break_statement' ||
      n.type === 'goto_statement' ||
      (n.type === 'invocation_expression' && /\bThrowIfCancellationRequested$/.test(n.childForFieldName('function')?.text ?? '')) ||
      (n.type === 'invocation_expression' && /(^|\.)Environment\.Exit$/.test(n.childForFieldName('function')?.text ?? '')),
    )
    if (exits) return null

    // Find the nearest enclosing loop within the same function.
    let loop: SyntaxNode | null = null
    let current: SyntaxNode | null = node.parent
    while (current && !CSHARP_FUNCTION_BOUNDARIES.has(current.type)) {
      if (CSHARP_LOOP_TYPES.has(current.type)) {
        loop = current
        break
      }
      current = current.parent
    }
    if (!loop || !isUnconditionalLoop(loop)) return null

    // The loop checks the token elsewhere (e.g. `if (token.IsCancellationRequested) break;`).
    const tokenCheck = findInSameFunction(loop, (n) =>
      n.type === 'member_access_expression' && n.childForFieldName('name')?.text === 'IsCancellationRequested',
    )
    if (tokenCheck) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Cancellation exception swallowed',
      `Catching \`${caughtType}\` without re-throwing inside an unconditional loop — cancellation is the only way this loop can stop, so swallowing the exception makes the worker uncancellable and shutdown hangs.`,
      sourceCode,
      'Re-throw the exception (`throw;`), `break` out of the loop, or make the loop condition check the CancellationToken.',
    )
  },
}
