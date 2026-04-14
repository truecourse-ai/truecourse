import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

function getSingleReturnValue(block: SyntaxNode): string | null {
  const stmts = block.namedChildren.filter((s) => s.type !== 'comment')
  if (stmts.length !== 1) return null
  const stmt = stmts[0]
  if (stmt.type !== 'return_statement') return null
  const val = stmt.namedChildren[0]
  return val ? val.text : null
}

export const pythonUselessIfElseVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-if-else',
  languages: ['python'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const consequence = node.childForFieldName('consequence')
    const elseClause = node.children.find((c) => c.type === 'else_clause')
    if (!consequence || !elseClause) return null

    // No elif
    const elifClause = node.children.find((c) => c.type === 'elif_clause')
    if (elifClause) return null

    const elseBlock = elseClause.namedChildren[0]
    if (!elseBlock || elseBlock.type !== 'block') return null

    const trueVal = getSingleReturnValue(consequence)
    const falseVal = getSingleReturnValue(elseBlock)

    if (trueVal === null || falseVal === null) return null

    // Case 1: Returns True/False based on condition
    if (
      (trueVal === 'True' && falseVal === 'False') ||
      (trueVal === 'False' && falseVal === 'True')
    ) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Useless if/else returning True/False',
        'This if/else block returns `True` or `False` based on the condition. Simplify by returning the condition directly.',
        sourceCode,
        trueVal === 'True'
          ? 'Replace the if/else with `return bool(condition)` or just `return condition`.'
          : 'Replace the if/else with `return not condition`.',
      )
    }

    // Case 2: Both branches return the same value
    if (trueVal === falseVal) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'if/else with identical return values',
        `Both branches return \`${trueVal}\` — the if/else condition has no effect.`,
        sourceCode,
        `Remove the if/else and return \`${trueVal}\` unconditionally.`,
      )
    }

    return null
  },
}
