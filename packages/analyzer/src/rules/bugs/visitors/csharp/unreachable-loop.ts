import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_LOOP_TYPES } from './_helpers.js'

/**
 * A loop whose body unconditionally exits (break/return/throw) on the first
 * iteration never loops. A `continue` anywhere in the body (outside nested
 * loops, whose continues bind to the inner loop) keeps it alive and
 * suppresses the rule.
 */
function bodyHasContinue(node: SyntaxNode): boolean {
  if (node.type === 'continue_statement') return true
  for (const child of node.namedChildren) {
    if (!child || CSHARP_LOOP_TYPES.has(child.type)) continue
    if (bodyHasContinue(child)) return true
  }
  return false
}

const EXITS = new Set(['return_statement', 'throw_statement', 'break_statement'])

export const csharpUnreachableLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unreachable-loop',
  languages: ['csharp'],
  nodeTypes: ['for_statement', 'foreach_statement', 'while_statement', 'do_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body || body.type !== 'block') return null

    const statements = body.namedChildren.filter((c) => c && c.type !== 'comment')
    if (statements.length === 0) return null

    const last = statements[statements.length - 1]!
    if (!EXITS.has(last.type)) return null
    if (bodyHasContinue(body)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Unreachable loop',
      `Loop body always exits on the first iteration via \`${last.type.replace('_statement', '')}\`.`,
      sourceCode,
      'If intentional, use an if statement instead. Otherwise, move the exit into a condition.',
    )
  },
}
