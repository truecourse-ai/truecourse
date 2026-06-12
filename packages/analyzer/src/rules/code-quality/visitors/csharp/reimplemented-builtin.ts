import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** The single boolean literal returned by a one-statement body, or null. */
function returnedBoolean(body: SyntaxNode | null): string | null {
  if (!body) return null
  let stmt: SyntaxNode | null = body
  if (body.type === 'block') {
    const stmts = body.namedChildren.filter((c) => c && c.type !== 'comment')
    if (stmts.length !== 1) return null
    stmt = stmts[0]
  }
  if (stmt?.type !== 'return_statement') return null
  const value = stmt.namedChildren[0]
  if (value?.type !== 'boolean_literal') return null
  return value.text
}

/**
 * `foreach (…) { if (pred) return true; } return false;` — this loop IS
 * `Any(pred)` (and the `return false` inside / `return true` after form is
 * `All`). Only the exact early-return-of-a-boolean-literal shape is flagged,
 * with the opposite literal returned immediately after the loop.
 */
export const csharpReimplementedBuiltinVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/reimplemented-builtin',
  languages: ['csharp'],
  nodeTypes: ['foreach_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body || body.type !== 'block') return null
    const stmts = body.namedChildren.filter((c) => c && c.type !== 'comment')
    if (stmts.length !== 1) return null
    const ifStmt = stmts[0]
    if (ifStmt?.type !== 'if_statement') return null
    if (ifStmt.childForFieldName('alternative')) return null

    const earlyReturn = returnedBoolean(ifStmt.childForFieldName('consequence'))
    if (earlyReturn === null) return null

    // The statement after the loop must return the opposite literal.
    const parent = node.parent
    if (!parent) return null
    let next: SyntaxNode | null = null
    let found = false
    for (const child of parent.namedChildren) {
      if (!child) continue
      if (found) { next = child; break }
      if (child.id === node.id) found = true
    }
    if (next?.type !== 'return_statement') return null
    const fallthrough = next.namedChildren[0]
    if (fallthrough?.type !== 'boolean_literal') return null
    if (fallthrough.text === earlyReturn) return null

    const builtin = earlyReturn === 'true' ? 'Any' : 'All'
    const condText = ifStmt.childForFieldName('condition')?.text ?? 'pred'
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `Loop reimplements ${builtin}()`,
      `This foreach hand-rolls LINQ \`${builtin}\` — \`return source.${builtin}(x => ${builtin === 'All' ? `!(${condText})` : condText});\` says it in one line.`,
      sourceCode,
      `Replace the loop and trailing return with \`return source.${builtin}(predicate);\`.`,
    )
  },
}
