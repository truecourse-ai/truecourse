import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpAttributeNames } from '../../../_shared/csharp-helpers.js'
import { CSHARP_FUNCTION_BOUNDARIES } from '../../../bugs/visitors/csharp/_helpers.js'

/**
 * An Azure Function entry point (`[Function]` / `[FunctionName]`) whose body
 * contains no try/catch. An unhandled exception in a function is reported by
 * the host generically and (for triggers like queues/timers) can silently
 * retry or drop the message — failures are invisible without explicit
 * handling. The function method is the right place to bracket the work.
 *
 * Precision:
 *   - only flagged for block-bodied functions whose body does real fallible
 *     work — at least one method invocation or await (an external/I-O call
 *     that can throw); a function that only mutates local/field state has
 *     nothing meaningful to guard and is not flagged;
 *   - a try anywhere in the body (including a try/finally) counts.
 */
const FUNCTION_ATTRS = new Set(['Function', 'FunctionName'])

function bodyHasTry(node: SyntaxNode): boolean {
  if (node.type === 'try_statement') return true
  for (const child of node.namedChildren) {
    if (!child || CSHARP_FUNCTION_BOUNDARIES.has(child.type)) continue
    if (bodyHasTry(child)) return true
  }
  return false
}

function bodyHasFallibleWork(node: SyntaxNode): boolean {
  if (node.type === 'invocation_expression' || node.type === 'await_expression') return true
  for (const child of node.namedChildren) {
    if (!child || CSHARP_FUNCTION_BOUNDARIES.has(child.type)) continue
    if (bodyHasFallibleWork(child)) return true
  }
  return false
}

export const csharpAzureFunctionNoErrorHandlingVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/azure-function-no-error-handling',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    const attrs = getCSharpAttributeNames(node)
    if (!attrs.some((a) => FUNCTION_ATTRS.has(a))) return null

    const body = node.childForFieldName('body')
    if (!body || body.type !== 'block') return null
    const statements = body.namedChildren.filter((c) => c && c.type !== 'comment')
    if (statements.length === 0) return null

    if (bodyHasTry(body)) return null
    if (!bodyHasFallibleWork(body)) return null

    const nameNode = node.childForFieldName('name') ?? node
    return makeViolation(
      this.ruleKey, nameNode, filePath, 'low',
      'Azure Function without structured error handling',
      'This Azure Function has no try/catch. An unhandled exception is surfaced only by the host and, for trigger bindings, can trigger silent retries or message loss — the failure is effectively invisible.',
      sourceCode,
      'Wrap the function body in try/catch, log the exception with the invocation context, and decide explicitly whether to swallow, rethrow, or dead-letter.',
    )
  },
}
