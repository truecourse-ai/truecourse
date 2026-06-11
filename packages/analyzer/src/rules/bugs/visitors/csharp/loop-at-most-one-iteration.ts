import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_LOOP_TYPES } from './_helpers.js'

/**
 * A loop whose body exits (return/throw/break) on EVERY path of the first
 * iteration never iterates twice. The unreachable-loop C# visitor already
 * owns the "block body whose LAST statement is an exit" shape, so this rule
 * fires only on the shapes it misses:
 *   - an `if`/`else` where BOTH branches exit (the last statement is the
 *     if, not an exit statement)
 *   - an unconditional exit followed by further (dead) statements
 *   - non-block single-statement bodies (`while (Poll()) break;`)
 *
 * Any `continue`/`goto` in the body (outside nested loops) keeps the loop
 * alive and suppresses the rule. `foreach (…) { if (c) return x; }` —
 * the find-first idiom — has a non-exiting path and never fires.
 */
const EXITS = new Set(['return_statement', 'throw_statement', 'break_statement'])

function containsLoopEscape(node: SyntaxNode): boolean {
  if (node.type === 'continue_statement' || node.type === 'goto_statement') return true
  for (const child of node.namedChildren) {
    if (!child || CSHARP_LOOP_TYPES.has(child.type)) continue
    if (containsLoopEscape(child)) return true
  }
  return false
}

/** True when every path through `stmt` exits the loop. */
function alwaysExits(stmt: SyntaxNode): boolean {
  if (EXITS.has(stmt.type)) return true
  if (stmt.type === 'block') {
    return stmt.namedChildren.some((c) => c !== null && c.type !== 'comment' && alwaysExits(c))
  }
  if (stmt.type === 'if_statement') {
    const consequence = stmt.childForFieldName('consequence')
    const alternative = stmt.childForFieldName('alternative')
    if (!consequence || !alternative) return false
    return alwaysExits(consequence) && alwaysExits(alternative)
  }
  return false
}

export const csharpLoopAtMostOneIterationVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/loop-at-most-one-iteration',
  languages: ['csharp'],
  nodeTypes: ['for_statement', 'foreach_statement', 'while_statement', 'do_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    if (containsLoopEscape(body)) return null

    const statements = body.type === 'block'
      ? body.namedChildren.filter((c): c is SyntaxNode => !!c && c.type !== 'comment')
      : [body]
    if (statements.length === 0) return null

    if (!statements.some(alwaysExits)) return null

    // The "block ending in a plain exit statement" shape is owned by
    // bugs/deterministic/unreachable-loop — don't double-fire.
    if (body.type === 'block' && EXITS.has(statements[statements.length - 1]!.type)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Loop with at most one iteration',
      'Every path through the loop body returns, throws, or breaks during the first iteration — the loop never repeats.',
      sourceCode,
      'Replace the loop with an `if` statement, or make one of the paths continue to the next iteration.',
    )
  },
}
