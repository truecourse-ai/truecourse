import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const accessorPairsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/accessor-pairs',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['object'],
  visit(node, filePath, sourceCode) {
    const getters = new Set<string>()
    const setters = new Set<string>()

    for (const child of node.namedChildren) {
      if (child.type === 'method_definition' || child.type === 'pair') {
        if (child.type === 'method_definition') {
          const kindNode = child.children.find((c) => c.type === 'get' || c.type === 'set')
          const nameNode = child.childForFieldName('name')
          if (!kindNode || !nameNode) continue
          if (kindNode.type === 'get') getters.add(nameNode.text)
          else if (kindNode.type === 'set') setters.add(nameNode.text)
        }
      }
    }

    for (const name of setters) {
      if (!getters.has(name)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Setter without getter',
          `Object has a setter for \`${name}\` but no corresponding getter. Add a getter or use a regular property.`,
          sourceCode,
          `Add a getter for \`${name}\`, or convert to a regular data property.`,
        )
      }
    }
    return null
  },
}
