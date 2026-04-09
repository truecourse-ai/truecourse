import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects:
 *   const obj = {};
 *   obj.a = 1;
 *   obj.b = 2;
 * Which can be written as: const obj = { a: 1, b: 2 };
 */
export const preferObjectLiteralVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-object-literal',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['variable_declarator'],
  visit(node, filePath, sourceCode) {
    const nameNode = node.childForFieldName('name')
    const valueNode = node.childForFieldName('value')

    if (!nameNode || !valueNode) return null
    if (nameNode.type !== 'identifier') return null
    if (valueNode.type !== 'object') return null

    // Check if the object is empty
    if (valueNode.namedChildren.length > 0) return null

    const varName = nameNode.text
    const parent = node.parent
    if (!parent) return null

    // Check if the declaration statement is followed by assignments like varName.prop = val
    const grandParent = parent.parent
    if (!grandParent) return null

    const stmts = grandParent.namedChildren
    const declIdx = stmts.findIndex((s) => s.id === parent.id)
    if (declIdx === -1 || declIdx + 1 >= stmts.length) return null

    const nextStmt = stmts[declIdx + 1]
    if (!nextStmt) return null

    // Check if next statement is varName.prop = val
    if (nextStmt.type !== 'expression_statement') return null
    const expr = nextStmt.namedChildren[0]
    if (!expr || expr.type !== 'assignment_expression') return null

    const assignLeft = expr.childForFieldName('left')
    if (!assignLeft || assignLeft.type !== 'member_expression') return null
    const objNode = assignLeft.childForFieldName('object')
    if (!objNode || objNode.text !== varName) return null

    return makeViolation(
      this.ruleKey, parent, filePath, 'low',
      'Prefer object literal',
      `\`const ${varName} = {}\` followed by property assignments — initialize properties in the object literal instead.`,
      sourceCode,
      `Replace with \`const ${varName} = { prop: value, ... }\`.`,
    )
  },
}
