import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * An if/else that assigns the *same* variable `true` in one branch and `false`
 * in the other is just assigning the condition (or its negation): the branching
 * obscures a one-line `x = condition;`. The check fires on an `if_statement`
 * whose consequence and alternative each contain a single boolean-literal
 * assignment to the same target with opposite literals.
 */
function singleBoolAssignment(branch: SyntaxNode | null): { target: string; value: boolean } | null {
  if (!branch) return null
  let stmt: SyntaxNode | null = branch
  if (branch.type === 'block') {
    const stmts = branch.namedChildren.filter((c) => c && c.type !== 'comment')
    if (stmts.length !== 1) return null
    stmt = stmts[0]!
  }
  if (stmt?.type !== 'expression_statement') return null
  const assign = stmt.namedChildren[0]
  if (assign?.type !== 'assignment_expression') return null
  if (assign.childForFieldName('operator')?.text !== '=') return null
  const lhs = assign.childForFieldName('left')
  const rhs = assign.childForFieldName('right')
  if (!lhs || rhs?.type !== 'boolean_literal') return null
  return { target: lhs.text, value: rhs.text === 'true' }
}

export const csharpIfToBooleanAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/if-to-boolean-assignment',
  languages: ['csharp'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    if (!condition) return null

    // Branches are the named children after the condition: [consequence, else].
    const branches = node.namedChildren.filter((c) => c && c.id !== condition.id) as SyntaxNode[]
    if (branches.length !== 2) return null
    // An `else if` chain shows up as an if_statement in the alternative slot.
    if (branches[1].type === 'if_statement') return null

    const a = singleBoolAssignment(branches[0])
    const b = singleBoolAssignment(branches[1])
    if (!a || !b) return null
    if (a.target !== b.target) return null
    if (a.value === b.value) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Convert if/else to a boolean assignment',
      `This if/else assigns \`${a.target}\` \`true\`/\`false\` from the same condition — collapse it to a single \`${a.target} = …;\` assignment.`,
      sourceCode,
      `Replace the if/else with \`${a.target} = <condition>;\` (negate the condition if needed).`,
    )
  },
}
