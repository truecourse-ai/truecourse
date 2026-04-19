import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES, getFunctionBody, getFunctionName } from './_helpers.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

export const preferSingleBooleanReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-single-boolean-return',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    // Skip callback functions passed to .filter(), .some(), .every(), .find(), .findIndex()
    const parent = node.parent
    if (parent?.type === 'arguments') {
      const callExpr = parent.parent
      if (callExpr?.type === 'call_expression') {
        const fn = callExpr.childForFieldName('function')
        if (fn?.type === 'member_expression') {
          const method = fn.childForFieldName('property')?.text
          if (method === 'filter' || method === 'some' || method === 'every' || method === 'find' || method === 'findIndex') {
            return null
          }
        }
      }
    }

    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    const stmts = bodyNode.namedChildren
    if (stmts.length < 2) return null

    let allBooleanReturns = true
    let hasAtLeastOneBoolReturn = false

    for (const stmt of stmts) {
      if (stmt.type === 'return_statement') {
        const val = stmt.namedChildren[0]
        if (val && (val.text === 'true' || val.text === 'false')) {
          hasAtLeastOneBoolReturn = true
        } else {
          allBooleanReturns = false
          break
        }
      } else if (stmt.type === 'if_statement') {
        function checkIfReturnsBoolean(n: SyntaxNode): boolean {
          const consequence = n.childForFieldName('consequence')
          if (!consequence) return false
          function getReturn(block: SyntaxNode): string | null {
            if (block.type === 'return_statement') {
              const val = block.namedChildren[0]
              return val?.text ?? null
            }
            if (block.type === 'statement_block') {
              const s = block.namedChildren
              if (s.length === 1) return getReturn(s[0])
            }
            return null
          }
          const retVal = getReturn(consequence)
          if (retVal !== 'true' && retVal !== 'false') return false
          hasAtLeastOneBoolReturn = true
          return true
        }
        if (!checkIfReturnsBoolean(stmt)) {
          allBooleanReturns = false
          break
        }
      } else {
        allBooleanReturns = false
        break
      }
    }

    if (allBooleanReturns && hasAtLeastOneBoolReturn && stmts.length >= 2) {
      const name = getFunctionName(node)
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Prefer single boolean return',
        `Function \`${name}\` returns true/false in multiple branches — use a single boolean expression.`,
        sourceCode,
        'Replace multiple boolean returns with a single `return <condition>` expression.',
      )
    }
    return null
  },
}
