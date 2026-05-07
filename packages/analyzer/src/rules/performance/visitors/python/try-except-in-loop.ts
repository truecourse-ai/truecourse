import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isInsidePythonLoop } from './_helpers.js'

// `except SomeSpecificError: continue` (or `: pass`) is the canonical Python
// "skip on this recoverable error and move on" idiom. The try/except shape
// is the language's only way to express this filter, and the except clause
// is rarely entered when the typical-case path through the try succeeds, so
// the per-iteration overhead is dominated by the try body, not by setting
// up the handler. Flagging this idiom conflicts with `try-except-continue`
// (which we already restrict to bare / generic catches) and produces noise.
//
// Bare except / `Exception` / `BaseException` swallowing is a separate
// concern - keep firing on those.
function isTypedSkipOnlyHandler(exceptClause: SyntaxNode): boolean {
  const block = exceptClause.namedChildren.find((c) => c.type === 'block')
  if (!block) return false
  const stmts = block.namedChildren.filter((c) => c.type !== 'comment')
  if (stmts.length !== 1) return false
  if (stmts[0].type !== 'continue_statement' && stmts[0].type !== 'pass_statement') return false

  const exprChildren = exceptClause.namedChildren.filter(
    (c) => c.type !== 'block' && c.type !== 'comment',
  )
  if (exprChildren.length === 0) return false // bare except
  const exceptionType = exprChildren[0]
  const typeText = exceptionType.type === 'as_pattern'
    ? exceptionType.namedChildren[0]?.text
    : exceptionType.text
  return typeText !== undefined && typeText !== 'Exception' && typeText !== 'BaseException'
}

export const tryExceptInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/try-except-in-loop',
  languages: ['python'],
  nodeTypes: ['try_statement'],
  visit(node, filePath, sourceCode) {
    if (!isInsidePythonLoop(node)) return null

    const exceptClauses = node.namedChildren.filter((c) => c.type === 'except_clause')
    if (exceptClauses.length > 0 && exceptClauses.every(isTypedSkipOnlyHandler)) {
      return null
    }

    // IO-bound loop body: when the try block does network/DB/file IO,
    // the per-iteration cost is dominated by the IO call (microseconds
    // to seconds) and try/except setup (nanoseconds) is invisible.
    // Flagging is pure noise — every paginated HTTP fetch, GraphQL
    // pagination loop, and per-page decode has this shape.
    //
    // Heuristic: scan the try block's body for `await ...` (async IO)
    // or canonical IO-library call shapes (`requests.`, `httpx.`,
    // `session.`, `urlopen`, `urllib.`, `subprocess.`, file-handle
    // methods, base64 decode, etc.). Cheap textual scan — false
    // negatives are acceptable since this rule is style-leaning.
    const tryBody = node.childForFieldName('body')
    if (tryBody) {
      const bodyText = tryBody.text
      const IO_PATTERNS = /\bawait\b|\brequests\.|\bhttpx\.|\bsession\.|\bsubprocess\.|\burllib\.|\burlopen\b|\bbase64\.|\.read\(|\.write\(|\.execute\(|\bopen\s*\(|\bjson\.loads?\b|\bjson\.dumps?\b|\bos\.(?:remove|stat|getenv|environ)/
      if (IO_PATTERNS.test(bodyText)) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'try/except inside loop',
      'try/except inside a loop adds overhead per iteration. Move the try/except outside the loop if possible.',
      sourceCode,
      'Wrap the entire loop in a try/except, or use a conditional check instead of exception handling.',
    )
  },
}
