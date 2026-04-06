import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects patterns like:
 *   const x = obj.x;
 *   const y = obj.y;
 * when they could be: const { x, y } = obj;
 *
 * Simplified to: detect `const x = obj.prop` where the variable name
 * matches the property name exactly.
 */
export const missingDestructuringVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/missing-destructuring',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['variable_declaration', 'lexical_declaration'],
  visit(node, filePath, sourceCode) {
    const declarators = node.namedChildren.filter((c) => c.type === 'variable_declarator')
    if (declarators.length !== 1) return null

    const decl = declarators[0]
    const nameNode = decl.childForFieldName('name')
    const valueNode = decl.childForFieldName('value')

    if (!nameNode || !valueNode) return null
    if (nameNode.type !== 'identifier') return null
    if (valueNode.type !== 'member_expression') return null

    const propNode = valueNode.childForFieldName('property')
    const objNode = valueNode.childForFieldName('object')
    if (!propNode || !objNode) return null

    // Only flag if variable name matches property name
    if (propNode.text !== nameNode.text) return null
    // Skip if it's a computed property
    if (valueNode.children.some((c) => c.type === '[')) return null
    // Skip if it's on `this`
    if (objNode.text === 'this') return null

    const objText = objNode.text

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Missing destructuring',
      `\`const ${nameNode.text} = ${objText}.${propNode.text}\` — use destructuring: \`const { ${nameNode.text} } = ${objText}\`.`,
      sourceCode,
      `Replace with destructuring: \`const { ${nameNode.text} } = ${objText};\`.`,
    )
  },
}
