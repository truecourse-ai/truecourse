import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_FUNCTION_BOUNDARIES } from './_helpers.js'

/**
 * Plain `=` assignment to the for-loop counter inside the loop body —
 * overwrites the iteration state instead of stepping it (`i = 0` resets the
 * loop). Compound updates (`i += batch`) are deliberate stepping and don't
 * fire.
 */
export const csharpLoopCounterAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/loop-counter-assignment',
  languages: ['csharp'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const init = node.childForFieldName('initializer')
    if (init?.type !== 'variable_declaration') return null
    const declarator = init.namedChildren.find((c) => c?.type === 'variable_declarator')
    const loopVar = declarator?.childForFieldName('name')?.text
    if (!loopVar) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    function findAssignment(n: SyntaxNode): SyntaxNode | null {
      if (n.type === 'assignment_expression') {
        const left = n.childForFieldName('left')
        const op = n.childForFieldName('operator')
        if (left?.text === loopVar && op?.text === '=') return n
      }
      if (CSHARP_FUNCTION_BOUNDARIES.has(n.type)) return null
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) {
          const found = findAssignment(child)
          if (found) return found
        }
      }
      return null
    }

    const assignment = findAssignment(body)
    if (!assignment) return null

    return makeViolation(
      this.ruleKey, assignment, filePath, 'high',
      'Loop counter assignment',
      `Loop counter \`${loopVar}\` is assigned inside the loop body instead of being incremented/decremented.`,
      sourceCode,
      'Use += or -= to step the loop counter, or restructure the loop.',
    )
  },
}
