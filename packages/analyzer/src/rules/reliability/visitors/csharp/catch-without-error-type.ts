import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, walkCSharp } from '../../../_shared/csharp-helpers.js'
import { simpleTypeName } from './_helpers.js'

const FUNCTION_BOUNDARIES = new Set([
  'lambda_expression',
  'anonymous_method_expression',
  'local_function_statement',
])

/** if/switch/ternary anywhere in the body, not descending into nested functions. */
function hasBranchingConstruct(node: SyntaxNode): boolean {
  if (
    node.type === 'if_statement' ||
    node.type === 'switch_statement' ||
    node.type === 'switch_expression' ||
    node.type === 'conditional_expression'
  ) return true
  if (FUNCTION_BOUNDARIES.has(node.type)) return false
  for (const child of node.namedChildren) {
    if (child && hasBranchingConstruct(child)) return true
  }
  return false
}

/** `ex is FooException`, `switch (ex)`, or `.GetType()` — the body narrows the error type. */
function discriminatesErrorType(body: SyntaxNode, paramName: string | null): boolean {
  let found = false
  walkCSharp(body, (n) => {
    if (found) return
    if (n.type === 'is_expression' || n.type === 'is_pattern_expression') {
      found = true
      return
    }
    if ((n.type === 'switch_statement' || n.type === 'switch_expression') && paramName) {
      const subject = n.childForFieldName('value') ?? n.namedChildren[0]
      if (subject?.text === paramName) found = true
      return
    }
    if (n.type === 'invocation_expression' && getCSharpMethodName(n) === 'GetType') {
      found = true
    }
  })
  return found
}

export const csharpCatchWithoutErrorTypeVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/catch-without-error-type',
  languages: ['csharp'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    // A catch typed to a specific exception (`catch (IOException ex)`) already
    // discriminates — only the catch-all forms `catch` / `catch (Exception ex)`
    // are candidates.
    const decl = node.namedChildren.find((c) => c?.type === 'catch_declaration')
    let paramName: string | null = null
    if (decl) {
      const typeText = decl.childForFieldName('type')?.text ?? ''
      if (simpleTypeName(typeText) !== 'Exception') return null
      paramName = decl.childForFieldName('name')?.text ?? null
    }

    // An exception filter (`catch (Exception ex) when (…)`) IS type/state
    // discrimination.
    if (node.namedChildren.some((c) => c?.type === 'catch_filter_clause')) return null

    const body = node.namedChildren.find((c) => c?.type === 'block')
    if (!body) return null

    // Short uniform handlers (log-and-return, log-and-rethrow) don't benefit
    // from type discrimination; flagging them is noise. Only multi-statement
    // bodies that actually branch are candidates — same precision constraints
    // as the JS visitor.
    const stmts = body.namedChildren.filter((c) => c && c.type !== 'comment')
    if (stmts.length <= 1) return null

    if (discriminatesErrorType(body, paramName)) return null
    if (!hasBranchingConstruct(body)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Catch without error type discrimination',
      'Catch-all block branches on state but never checks the exception type. Different exception types (timeouts, cancellation, argument errors) usually need different handling.',
      sourceCode,
      'Catch specific exception types (catch (HttpRequestException ex)), or use `ex is T` pattern checks / a `when` filter inside the catch-all.',
    )
  },
}
