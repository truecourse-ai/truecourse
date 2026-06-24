import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { CSHARP_LOG_METHOD_NAMES, CSHARP_METHODLIKE_TYPES, getCSharpFunctionName, isCSharpFunctionBoundary } from './_helpers.js'

const MAX_LOG_CALLS = 7

/**
 * A method peppered with logging calls is a noise and performance signal:
 * the log volume drowns the actual events and adds overhead on the hot path
 * The check counts logging invocations (`_logger.LogInformation(…)`,
 * Serilog `Log.Information(…)`, etc.) directly inside a method and fires when
 * the count exceeds the threshold. To avoid false positives on a receiver named
 * `Log` that is not a logger, a call's receiver must look like a logger (`Log`,
 * `Logger`, or a name containing "log"/"logger").
 */
function looksLikeLogger(receiver: string): boolean {
  if (!receiver) return false
  const last = receiver.split('.').pop() ?? receiver
  return /log/i.test(last)
}

function countLogCalls(node: SyntaxNode, root: SyntaxNode): number {
  let count = 0
  for (const child of node.namedChildren) {
    if (!child) continue
    // Nested functions/lambdas/types are charged to themselves.
    if (isCSharpFunctionBoundary(child.type) && child.id !== root.id) continue
    if (child.type === 'class_declaration' || child.type === 'struct_declaration'
      || child.type === 'record_declaration') continue
    if (child.type === 'invocation_expression'
      && CSHARP_LOG_METHOD_NAMES.has(getCSharpMethodName(child))
      && looksLikeLogger(getCSharpReceiver(child))) {
      count++
    }
    count += countLogCalls(child, root)
  }
  return count
}

export const csharpTooManyLoggingCallsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-logging-calls',
  languages: ['csharp'],
  nodeTypes: CSHARP_METHODLIKE_TYPES,
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body || body.type !== 'block') return null

    const count = countLogCalls(body, node)
    if (count <= MAX_LOG_CALLS) return null

    const name = getCSharpFunctionName(node)
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Too many logging calls',
      `Method \`${name}\` makes ${count} logging calls (threshold: ${MAX_LOG_CALLS}) — a noise and performance signal.`,
      sourceCode,
      'Reduce the logging volume, or consolidate related log statements.',
    )
  },
}
