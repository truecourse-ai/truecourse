import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { csharpSingleAssignment } from './if-else-instead-of-ternary.js'

const COMPARISON_OPS = new Set(['>', '<', '>=', '<='])

/**
 * For comparison operands (a, b) and the two result expressions, decide
 * whether the construct computes Math.Max or Math.Min.
 */
function minMaxKind(op: string, a: string, b: string, whenTrue: string, whenFalse: string): 'Max' | 'Min' | null {
  const greater = op === '>' || op === '>='
  if (whenTrue === a && whenFalse === b) return greater ? 'Max' : 'Min'
  if (whenTrue === b && whenFalse === a) return greater ? 'Min' : 'Max'
  return null
}

function analyzeComparison(condition: SyntaxNode | null): { op: string; a: string; b: string } | null {
  if (condition?.type !== 'binary_expression') return null
  const op = condition.childForFieldName('operator')?.text ?? ''
  if (!COMPARISON_OPS.has(op)) return null
  const a = condition.childForFieldName('left')?.text
  const b = condition.childForFieldName('right')?.text
  if (!a || !b) return null
  return { op, a, b }
}

/**
 * Manual minimum/maximum: `x = a > b ? a : b` and the if/else form
 * `if (a > b) x = a; else x = b;` — `Math.Max(a, b)` names the intent.
 */
export const csharpIfExprMinMaxVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/if-expr-min-max',
  languages: ['csharp'],
  nodeTypes: ['conditional_expression', 'if_statement'],
  visit(node, filePath, sourceCode) {
    let kind: 'Max' | 'Min' | null = null
    let a = ''
    let b = ''

    if (node.type === 'conditional_expression') {
      const cmp = analyzeComparison(node.childForFieldName('condition'))
      if (!cmp) return null
      const whenTrue = node.childForFieldName('consequence')?.text
      const whenFalse = node.childForFieldName('alternative')?.text
      if (!whenTrue || !whenFalse) return null
      kind = minMaxKind(cmp.op, cmp.a, cmp.b, whenTrue, whenFalse)
      a = cmp.a
      b = cmp.b
    } else {
      const alternative = node.childForFieldName('alternative')
      if (!alternative || alternative.type === 'if_statement') return null
      const cmp = analyzeComparison(node.childForFieldName('condition'))
      if (!cmp) return null
      const thenAssign = csharpSingleAssignment(node.childForFieldName('consequence'))
      const elseAssign = csharpSingleAssignment(alternative)
      if (!thenAssign || !elseAssign || thenAssign.target !== elseAssign.target) return null
      kind = minMaxKind(cmp.op, cmp.a, cmp.b, thenAssign.value.text, elseAssign.value.text)
      a = cmp.a
      b = cmp.b
    }

    if (!kind) return null
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `Manual ${kind === 'Max' ? 'maximum' : 'minimum'}`,
      `This ${node.type === 'conditional_expression' ? 'conditional expression' : 'if/else'} hand-rolls a ${kind === 'Max' ? 'maximum' : 'minimum'} — \`Math.${kind}(${a}, ${b})\` names the intent.`,
      sourceCode,
      `Replace with \`Math.${kind}(${a}, ${b})\`.`,
    )
  },
}
