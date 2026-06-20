import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { CSHARP_FUNCTION_BOUNDARIES } from '../../../bugs/visitors/csharp/_helpers.js'

/**
 * A catch block that BOTH logs the exception AND rethrows it. As the exception
 * bubbles up, each layer that does this logs the same failure again, producing
 * duplicate stack traces and noisy logs for a single root cause. The choice is
 * binary: log here and stop (handle), or rethrow and let an outer layer log.
 *
 * Detection (no type info needed):
 *   - a bare `throw;` (or `throw <caughtVar>;`) somewhere in the catch body, AND
 *   - a logging call (Log…/Write…/Error/Trace) whose arguments reference the
 *     caught exception variable.
 *
 * We only flag a bare rethrow / rethrow of the same exception. `throw new
 * WrapperException(..., ex)` is the correct enrich-and-rethrow idiom and is not
 * a duplicate-noise problem.
 */
const LOG_METHOD_RE = /^(Log|Write|Trace|Error|Warn|Fatal|Critical|Debug|Info|Exception|Capture|Record)/

function caughtVariableName(catchClause: SyntaxNode): string | null {
  const decl = catchClause.namedChildren.find((c) => c?.type === 'catch_declaration')
  if (!decl) return null
  const id = decl.namedChildren.find((c) => c?.type === 'identifier' && c !== decl.namedChildren[0])
  // catch_declaration children are [typeIdentifier, varIdentifier]; var is last.
  const ids = decl.namedChildren.filter((c) => c?.type === 'identifier')
  return ids.length >= 2 ? ids[ids.length - 1]!.text : (id?.text ?? null)
}

interface CatchScan {
  rethrow: SyntaxNode | null
  logged: boolean
}

function scan(node: SyntaxNode, caughtVar: string | null, acc: CatchScan): void {
  if (CSHARP_FUNCTION_BOUNDARIES.has(node.type)) return
  if (node.type === 'try_statement') return // nested try owns its own catches

  if (node.type === 'throw_statement') {
    // Bare `throw;` has no value; `throw ex;` rethrows the caught var.
    const value = node.namedChildren[0]
    if (!value) {
      acc.rethrow = acc.rethrow ?? node
    } else if (caughtVar && value.type === 'identifier' && value.text === caughtVar) {
      acc.rethrow = acc.rethrow ?? node
    }
    // `throw new ...(ex)` (object_creation) is enrichment, not a duplicate.
    return
  }

  if (node.type === 'invocation_expression') {
    const method = getCSharpMethodName(node)
    if (LOG_METHOD_RE.test(method) && caughtVar) {
      const args = node.childForFieldName('arguments')
      if (args && args.text.includes(caughtVar)) acc.logged = true
    }
  }

  for (const child of node.namedChildren) {
    if (child) scan(child, caughtVar, acc)
  }
}

export const csharpExceptionLoggedAndRethrownVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/exception-logged-and-rethrown',
  languages: ['csharp'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    const block = node.namedChildren.find((c) => c?.type === 'block')
    if (!block) return null

    const caughtVar = caughtVariableName(node)
    const acc: CatchScan = { rethrow: null, logged: false }
    for (const child of block.namedChildren) {
      if (child) scan(child, caughtVar, acc)
    }

    if (!acc.logged || !acc.rethrow) return null

    return makeViolation(
      this.ruleKey, acc.rethrow, filePath, 'low',
      'Exception both logged and rethrown',
      'This catch block logs the exception and then rethrows it. Every outer handler that does the same logs the identical failure again, so one root cause produces a wall of duplicate stack traces.',
      sourceCode,
      'Pick one: log here and handle (do not rethrow), or rethrow and let a single outer boundary do the logging.',
    )
  },
}
