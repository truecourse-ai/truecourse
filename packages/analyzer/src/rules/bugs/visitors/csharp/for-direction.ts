import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `for (int i = 0; i < n; i--)` — the update moves the counter away from the
 * bound the condition checks, so the loop either never runs or runs forever.
 */
function updateDirection(update: SyntaxNode): 'up' | 'down' | null {
  if (update.type === 'postfix_unary_expression' || update.type === 'prefix_unary_expression') {
    if (update.children.some((c) => c?.type === '++')) return 'up'
    if (update.children.some((c) => c?.type === '--')) return 'down'
    return null
  }
  if (update.type === 'assignment_expression') {
    const op = update.childForFieldName('operator')?.text
    if (op === '+=') return 'up'
    if (op === '-=') return 'down'
  }
  return null
}

export const csharpForDirectionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/for-direction',
  languages: ['csharp'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    const update = node.childForFieldName('update')
    if (!condition || !update || condition.type !== 'binary_expression') return null

    const condOp = condition.childForFieldName('operator')?.text
    if (!condOp || !['<', '<=', '>', '>='].includes(condOp)) return null

    // The counter must be on the left of the comparison (`i < n`, not `n > i`)
    const counter = condition.childForFieldName('left')
    if (counter?.type !== 'identifier') return null
    const updated = update.type === 'assignment_expression'
      ? update.childForFieldName('left')
      : update.namedChildren[0]
    if (updated?.text !== counter.text) return null

    const direction = updateDirection(update)
    if (!direction) return null

    const isWrong =
      (direction === 'down' && (condOp === '<' || condOp === '<=')) ||
      (direction === 'up' && (condOp === '>' || condOp === '>='))
    if (!isWrong) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Wrong loop direction',
      `Loop counter goes ${direction} but condition uses \`${condOp}\` — this will either loop infinitely or never execute.`,
      sourceCode,
      'Fix the loop: change the update direction or the comparison operator.',
    )
  },
}
