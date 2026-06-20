import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** Parse a (possibly negative) integer literal node to a number, else null. */
function literalValue(node: SyntaxNode | null): number | null {
  if (!node) return null
  if (node.type === 'integer_literal') {
    const n = Number(node.text.replace(/_/g, '').replace(/[uUlL]+$/, ''))
    return Number.isFinite(n) ? n : null
  }
  // `-5` is a prefix_unary_expression over an integer_literal
  if (node.type === 'prefix_unary_expression' && node.children.some((c) => c?.type === '-')) {
    const operand = node.namedChildren[0]
    const inner = literalValue(operand ?? null)
    return inner === null ? null : -inner
  }
  return null
}

/** Evaluate a constant `<left> <op> <right>` integer comparison. */
function evalComparison(left: number, op: string, right: number): boolean | null {
  switch (op) {
    case '<': return left < right
    case '<=': return left <= right
    case '>': return left > right
    case '>=': return left >= right
    case '==': return left === right
    case '!=': return left !== right
    default: return null
  }
}

/**
 * A `for` loop whose condition is already false on entry given a constant
 * initializer, so the body never runs — e.g. `for (int i = 5; i < 3; i++)`.
 * This is dead code and almost always a typo in the bound or the start value.
 *
 * Only fully constant cases are evaluated: the counter is initialized to an
 * integer literal in the loop's own initializer and the condition compares that
 * same counter against an integer literal. Anything non-constant (a variable
 * bound, a method call) is left alone, since its truth is not knowable here.
 * The wrong-direction case (`i--` with `i < n`) is handled by `for-direction`.
 */
export const csharpForConditionNeverTrueVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/for-condition-never-true',
  languages: ['csharp'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    if (condition?.type !== 'binary_expression') return null
    const op = condition.childForFieldName('operator')?.text
    if (!op) return null
    const counter = condition.childForFieldName('left')
    if (counter?.type !== 'identifier') return null
    const bound = literalValue(condition.childForFieldName('right'))
    if (bound === null) return null

    // The counter must be declared in this for's own initializer with a literal.
    const declaration = node.namedChildren.find((c) => c?.type === 'variable_declaration')
    if (!declaration) return null
    let start: number | null = null
    for (const declarator of declaration.namedChildren) {
      if (declarator?.type !== 'variable_declarator') continue
      if (declarator.childForFieldName('name')?.text !== counter.text) continue
      // variable_declarator named children: [name identifier, initializer expr]
      start = literalValue(declarator.namedChildren[1] ?? null)
    }
    if (start === null) return null

    if (evalComparison(start, op, bound) !== false) return null

    return makeViolation(
      this.ruleKey, condition, filePath, 'high',
      'Loop condition is false at entry',
      `The condition \`${condition.text}\` is already false when the loop starts (\`${counter.text}\` begins at ${start}), so the loop body never executes.`,
      sourceCode,
      'Correct the start value or the bound so the loop runs, or remove the dead loop.',
    )
  },
}
