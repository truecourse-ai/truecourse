import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES, getFunctionBody } from './_helpers.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

function typeContainsBoolean(n: SyntaxNode): boolean {
  if (n.type === 'parenthesized_type') {
    const inner = n.namedChild(0)
    return inner ? typeContainsBoolean(inner) : false
  }
  if (n.type === 'predefined_type' && n.text === 'boolean') return true
  if (n.type === 'literal_type' && (n.text === 'true' || n.text === 'false')) return true
  if (n.type === 'union_type') {
    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i)
      if (child && typeContainsBoolean(child)) return true
    }
  }
  return false
}

export const selectorParameterVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/selector-parameter',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const params = node.childForFieldName('parameters')
    if (!params) return null

    const paramList = params.namedChildren
    if (paramList.length === 0) return null

    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    for (const param of paramList) {
      let paramName: string | null = null
      let typeAnnotation: SyntaxNode | null = null

      if (param.type === 'identifier') {
        paramName = param.text
      } else if (param.type === 'required_parameter' || param.type === 'optional_parameter') {
        const p = param.childForFieldName('pattern') ?? param.namedChildren[0]
        if (p?.type === 'identifier') paramName = p.text
        typeAnnotation = param.namedChildren.find((c) => c.type === 'type_annotation') ?? null
      }

      if (!paramName) continue

      // Only flag boolean-typed parameters. A name like `allowed` or `included`
      // matches the selector-word heuristic, but holding `string | string[]`
      // (or any non-boolean type) means the parameter is data, not a behavior
      // switch — splitting the function in two would not make sense.
      if (typeAnnotation) {
        const typeNode = typeAnnotation.namedChild(0)
        if (typeNode && !typeContainsBoolean(typeNode)) continue
      }

      function isUsedAsSelector(n: SyntaxNode): boolean {
        if (JS_FUNCTION_TYPES.includes(n.type) && n.id !== node.id) return false
        if (n.type === 'if_statement') {
          const condition = n.childForFieldName('condition')
          if (condition) {
            let condExpr: SyntaxNode | null = condition
            if (condExpr.type === 'parenthesized_expression') {
              condExpr = condExpr.namedChildren[0] ?? null
            }
            if (condExpr?.type === 'identifier' && condExpr.text === paramName) return true
            if (condExpr?.type === 'unary_expression' && condExpr.children[0]?.text === '!'
              && condExpr.namedChildren[0]?.text === paramName) return true
          }
        }
        for (let i = 0; i < n.childCount; i++) {
          const child = n.child(i)
          if (child && isUsedAsSelector(child)) return true
        }
        return false
      }

      if (isUsedAsSelector(bodyNode)) {
        const selectorNames = /^(is|has|should|with|enable|show|force|flag|toggle|include|exclude|allow|skip|only)/i
        if (selectorNames.test(paramName) || paramName.endsWith('Flag') || paramName.endsWith('Mode') || paramName === 'mode') {
          return makeViolation(
            this.ruleKey, param, filePath, 'low',
            'Selector parameter',
            `Parameter \`${paramName}\` controls function behavior like a boolean flag. Consider splitting into two separate functions.`,
            sourceCode,
            `Split the function into two: one for each behavior controlled by \`${paramName}\`.`,
          )
        }
      }
    }
    return null
  },
}
