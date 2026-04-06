import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects:
 *   if x in s:
 *       s.remove(x)
 * Should use s.discard(x) instead.
 */
export const pythonCheckAndRemoveFromSetVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/check-and-remove-from-set',
  languages: ['python'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    // condition: `x in s` or `x in some_set`
    const condition = node.childForFieldName('condition')
    if (!condition) return null
    if (condition.type !== 'comparison_operator') return null

    const condChildren = condition.children
    const inIdx = condChildren.findIndex((c) => c.type === 'in')
    if (inIdx === -1) return null

    const leftNode = condition.namedChildren[0]
    const rightNode = condition.namedChildren[condition.namedChildren.length - 1]
    if (!leftNode || !rightNode) return null

    const elem = leftNode.text
    const container = rightNode.text

    // body: single statement `container.remove(elem)`
    // Python grammar uses 'consequence' field for the if body (a block node)
    const body = node.childForFieldName('consequence') ?? node.childForFieldName('body')
    if (!body) return null

    const statements = body.namedChildren.filter((c) => c.type !== 'comment')
    if (statements.length !== 1) return null

    const stmt = statements[0]
    if (stmt.type !== 'expression_statement') return null

    const expr = stmt.namedChildren[0]
    if (!expr || expr.type !== 'call') return null

    const fn = expr.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const obj = fn.childForFieldName('object')
    const attr = fn.childForFieldName('attribute')
    if (!obj || !attr) return null

    if (obj.text !== container || attr.text !== 'remove') return null

    const args = expr.childForFieldName('arguments')
    const argNodes = args?.namedChildren ?? []
    if (argNodes.length !== 1 || argNodes[0].text !== elem) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Check before set.remove()',
      `Checking \`${elem} in ${container}\` before \`${container}.remove(${elem})\` is redundant. Use \`${container}.discard(${elem})\` which is safe even if the element is absent.`,
      sourceCode,
      `Replace with \`${container}.discard(${elem})\`.`,
    )
  },
}
