import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpAttributeNames, getCSharpEnclosingFunction, getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { CSHARP_FUNCTION_BOUNDARIES } from '../../../bugs/visitors/csharp/_helpers.js'

/**
 * A catch block inside an Azure Function (`[Function]`/`[FunctionName]` method)
 * that swallows the exception without logging it. Inside a function, a
 * swallowed-and-unlogged exception is the worst case: the host sees success,
 * the message is acked, and the failure leaves no trace.
 *
 * Detection (no type info needed):
 *   - the enclosing method carries a function attribute, AND
 *   - the catch neither logs the exception nor rethrows it (a rethrow lets the
 *     host record the failure; logging records it locally — either is fine).
 */
const FUNCTION_ATTRS = new Set(['Function', 'FunctionName'])
const LOG_METHOD_RE = /^(Log|Write|Trace|Error|Warn|Fatal|Critical|Debug|Info|Exception|Capture|Record)/

function enclosingFunctionMethod(node: SyntaxNode): SyntaxNode | null {
  let fn = getCSharpEnclosingFunction(node)
  while (fn) {
    if (fn.type === 'method_declaration') return fn
    fn = getCSharpEnclosingFunction(fn)
  }
  return null
}

function scan(node: SyntaxNode, acc: { logged: boolean; rethrew: boolean }): void {
  if (CSHARP_FUNCTION_BOUNDARIES.has(node.type) || node.type === 'try_statement') return
  if (node.type === 'throw_statement') {
    acc.rethrew = true
    return
  }
  if (node.type === 'invocation_expression') {
    if (LOG_METHOD_RE.test(getCSharpMethodName(node))) acc.logged = true
  }
  for (const child of node.namedChildren) {
    if (child) scan(child, acc)
  }
}

export const csharpAzureFunctionFailureNotLoggedVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/azure-function-failure-not-logged',
  languages: ['csharp'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    const method = enclosingFunctionMethod(node)
    if (!method) return null
    if (!getCSharpAttributeNames(method).some((a) => FUNCTION_ATTRS.has(a))) return null

    const block = node.namedChildren.find((c) => c?.type === 'block')
    if (!block) return null

    const acc = { logged: false, rethrew: false }
    for (const child of block.namedChildren) {
      if (child) scan(child, acc)
    }
    if (acc.logged || acc.rethrew) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Azure Function failure swallowed without logging',
      'This catch inside an Azure Function neither logs the exception nor rethrows it. The host records the invocation as successful, the trigger message is acknowledged, and the failure disappears with no trace.',
      sourceCode,
      'Log the exception with the function logger (or rethrow so the host records the failure) before deciding how to handle it.',
    )
  },
}
