import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_METHODLIKE_TYPES, getCSharpFunctionName } from './_helpers.js'

function returnedBooleanLiteral(stmt: SyntaxNode): string | null {
  let target = stmt
  if (target.type === 'block') {
    const stmts = target.namedChildren
    if (stmts.length !== 1 || !stmts[0]) return null
    target = stmts[0]
  }
  if (target.type !== 'return_statement') return null
  const value = target.namedChildren[0]
  if (value?.type === 'boolean_literal') return value.text
  return null
}

/**
 * Method body consisting solely of `if (…) return true/false;` branches and
 * bare boolean returns — collapsible to one boolean expression.
 */
export const csharpPreferSingleBooleanReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-single-boolean-return',
  languages: ['csharp'],
  nodeTypes: CSHARP_METHODLIKE_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = node.childForFieldName('body')
    if (!bodyNode || bodyNode.type !== 'block') return null

    const stmts = bodyNode.namedChildren.filter(Boolean) as SyntaxNode[]
    if (stmts.length < 2) return null

    let hasBoolReturn = false

    for (const stmt of stmts) {
      if (stmt.type === 'return_statement') {
        const value = stmt.namedChildren[0]
        if (value?.type !== 'boolean_literal') return null
        hasBoolReturn = true
      } else if (stmt.type === 'if_statement') {
        const consequence = stmt.childForFieldName('consequence')
        if (!consequence || returnedBooleanLiteral(consequence) === null) return null
        const alternative = stmt.childForFieldName('alternative')
        if (alternative && returnedBooleanLiteral(alternative) === null) return null
        hasBoolReturn = true
      } else {
        return null
      }
    }

    if (!hasBoolReturn) return null

    const name = getCSharpFunctionName(node)
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Prefer single boolean return',
      `Method \`${name}\` returns true/false in multiple branches — use a single boolean expression.`,
      sourceCode,
      'Replace multiple boolean returns with a single `return <condition>;` expression.',
    )
  },
}
