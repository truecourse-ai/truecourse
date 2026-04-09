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
    // Skip when the object expression contains `as any` or `as unknown` — destructuring would lose the cast
    const objText0 = objNode.text
    if (objText0.includes('as any') || objText0.includes('as unknown')) return null

    const objText = objNode.text

    // Only flag when there are 2+ sequential property accesses from the same object
    // in the same block — a single access doesn't benefit from destructuring
    const parentBlock = node.parent
    if (!parentBlock) return null

    const siblings = parentBlock.namedChildren
    const myIndex = siblings.findIndex(n => n.id === node.id)
    let sameObjectCount = 0
    for (let i = Math.max(0, myIndex - 5); i < Math.min(siblings.length, myIndex + 6); i++) {
      const sib = siblings[i]
      if (sib.type !== 'variable_declaration' && sib.type !== 'lexical_declaration') continue
      const sibDecl = sib.namedChildren.find((c) => c.type === 'variable_declarator')
      if (!sibDecl) continue
      const sibValue = sibDecl.childForFieldName('value')
      if (sibValue?.type !== 'member_expression') continue
      const sibObj = sibValue.childForFieldName('object')
      if (sibObj?.text === objText) sameObjectCount++
    }
    if (sameObjectCount < 2) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Missing destructuring',
      `\`const ${nameNode.text} = ${objText}.${propNode.text}\` — use destructuring: \`const { ${nameNode.text} } = ${objText}\`.`,
      sourceCode,
      `Replace with destructuring: \`const { ${nameNode.text} } = ${objText};\`.`,
    )
  },
}
