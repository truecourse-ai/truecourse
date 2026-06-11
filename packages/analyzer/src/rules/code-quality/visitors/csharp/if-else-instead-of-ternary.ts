import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** The single `target = value` assignment in a branch body, or null. */
export function csharpSingleAssignment(body: SyntaxNode | null): { target: string; value: SyntaxNode } | null {
  if (!body) return null
  let stmt: SyntaxNode | null = body
  if (body.type === 'block') {
    const stmts = body.namedChildren.filter((c) => c && c.type !== 'comment')
    if (stmts.length !== 1) return null
    stmt = stmts[0]
  }
  if (stmt?.type !== 'expression_statement') return null
  const expr = stmt.namedChildren[0]
  if (expr?.type !== 'assignment_expression') return null
  if (expr.childForFieldName('operator')?.text !== '=') return null
  const left = expr.childForFieldName('left')
  const right = expr.childForFieldName('right')
  if (!left || !right) return null
  if (left.type !== 'identifier' && left.type !== 'member_access_expression') return null
  return { target: left.text, value: right }
}

const COMPARISON_OPS = new Set(['>', '<', '>=', '<='])

/** True when the if/else assignments are the manual Math.Min/Max shape (owned by if-expr-min-max). */
function isMinMaxShape(condition: SyntaxNode | null, thenValue: SyntaxNode, elseValue: SyntaxNode): boolean {
  if (condition?.type !== 'binary_expression') return false
  if (!COMPARISON_OPS.has(condition.childForFieldName('operator')?.text ?? '')) return false
  const a = condition.childForFieldName('left')?.text
  const b = condition.childForFieldName('right')?.text
  return (thenValue.text === a && elseValue.text === b) || (thenValue.text === b && elseValue.text === a)
}

/**
 * `if (cond) x = a; else x = b;` — a conditional expression states the
 * single assignment directly (IDE0045): `x = cond ? a : b;`.
 */
export const csharpIfElseInsteadOfTernaryVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/if-else-instead-of-ternary',
  languages: ['csharp'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const alternative = node.childForFieldName('alternative')
    if (!alternative || alternative.type === 'if_statement') return null

    const thenAssign = csharpSingleAssignment(node.childForFieldName('consequence'))
    const elseAssign = csharpSingleAssignment(alternative)
    if (!thenAssign || !elseAssign) return null
    if (thenAssign.target !== elseAssign.target) return null
    // Identical values → if-with-same-arms; nested ternaries would get worse.
    if (thenAssign.value.text === elseAssign.value.text) return null
    if (thenAssign.value.type === 'conditional_expression' || elseAssign.value.type === 'conditional_expression') return null
    // The manual min/max shape is owned by if-expr-min-max.
    if (isMinMaxShape(node.childForFieldName('condition'), thenAssign.value, elseAssign.value)) return null

    const condText = node.childForFieldName('condition')?.text ?? 'condition'
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'if/else instead of conditional expression',
      `Both branches assign \`${thenAssign.target}\` — collapse to \`${thenAssign.target} = ${condText} ? ${thenAssign.value.text} : ${elseAssign.value.text};\` (IDE0045).`,
      sourceCode,
      `Replace the if/else with: \`${thenAssign.target} = ${condText} ? ${thenAssign.value.text} : ${elseAssign.value.text};\``,
    )
  },
}
