import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

const ALWAYS_TRUTHY_LITERALS = new Set(['True', '1', '"text"', "'text'"])
const ALWAYS_FALSY_LITERALS = new Set(['False', '0', 'None', '""', "''"])

function isConstantLiteral(node: SyntaxNode): boolean {
  return (
    node.type === 'true' ||
    node.type === 'false' ||
    node.type === 'none' ||
    node.type === 'integer' ||
    node.type === 'float' ||
    node.type === 'string'
  )
}

export const pythonUnconditionalAssertionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unconditional-assertion',
  languages: ['python'],
  nodeTypes: ['assert_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr) return null

    if (isConstantLiteral(expr)) {
      const value = expr.text
      const alwaysPasses = expr.type === 'true' ||
        (expr.type === 'integer' && value !== '0') ||
        (expr.type === 'string' && value !== '""' && value !== "''")

      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Unconditional assertion',
        `\`assert ${value}\` is always ${alwaysPasses ? 'True (passes)' : 'False (fails)'}. This assertion tests a constant value and is useless.`,
        sourceCode,
        'Remove the assertion or replace it with one that actually tests a runtime condition.',
      )
    }

    // Also catch: assert (a == a) with same variable on both sides
    if (expr.type === 'comparison_operator') {
      const left = expr.namedChildren[0]
      const right = expr.namedChildren[expr.namedChildren.length - 1]
      const op = expr.children.find((c) => !c.isNamed)?.text
      if (op === '==' && left && right && left.text === right.text && left.type === 'identifier') {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Unconditional assertion',
          `\`assert ${left.text} == ${right.text}\` always succeeds because both sides are the same variable.`,
          sourceCode,
          'This assertion tests nothing — remove it or fix the test to use different values.',
        )
      }
    }

    return null
  },
}
