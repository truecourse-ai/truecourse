import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// Detect patterns like: x++ + y, x-- - y, +x++ etc.
// i.e. update expressions (++/--) used inside a larger arithmetic/assignment expression

function isArithmeticOrAssignment(type: string): boolean {
  return type === 'binary_expression' || type === 'assignment_expression' || type === 'augmented_assignment_expression'
}

function containsUpdateExpr(node: SyntaxNode): boolean {
  if (node.type === 'update_expression') return true
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && containsUpdateExpr(child)) return true
  }
  return false
}

export const confusingIncrementDecrementVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/confusing-increment-decrement',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression', 'assignment_expression'],
  visit(node, filePath, sourceCode) {
    // Check if the node itself contains an update expression as a direct or nested operand
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')

    const leftIsUpdate = left?.type === 'update_expression'
    const rightIsUpdate = right?.type === 'update_expression'

    if (leftIsUpdate || rightIsUpdate) {
      const op = node.children.find(c => c.type !== 'comment' && !c.isNamed)?.text ?? ''
      // Only flag actual arithmetic/assignment with increment/decrement
      if (['+', '-', '*', '/', '%', '=', '+=', '-=', '**'].includes(op)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Confusing increment/decrement',
          `Using \`++\` or \`--\` within a larger expression makes the evaluation order confusing. Extract the increment/decrement to a separate statement.`,
          sourceCode,
          'Split the increment/decrement into its own statement to avoid confusion.',
        )
      }
    }
    return null
  },
}
