import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const ungroupedAccessorPairVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/ungrouped-accessor-pair',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['class_body'],
  visit(node, filePath, sourceCode) {
    const accessorPositions = new Map<string, { getIdx: number; setIdx: number }>()

    const members = node.namedChildren
    for (let i = 0; i < members.length; i++) {
      const member = members[i]
      if (member.type !== 'method_definition') continue

      const kindNode = member.children.find((c) => c.type === 'get' || c.type === 'set')
      if (!kindNode) continue

      const nameNode = member.childForFieldName('name')
      if (!nameNode) continue
      const name = nameNode.text

      const entry = accessorPositions.get(name) ?? { getIdx: -1, setIdx: -1 }
      if (kindNode.type === 'get') entry.getIdx = i
      else entry.setIdx = i
      accessorPositions.set(name, entry)
    }

    for (const [name, { getIdx, setIdx }] of accessorPositions) {
      if (getIdx === -1 || setIdx === -1) continue
      if (Math.abs(getIdx - setIdx) > 1) {
        const reportNode = members[Math.min(getIdx, setIdx)]
        return makeViolation(
          this.ruleKey, reportNode, filePath, 'low',
          'Ungrouped getter/setter pair',
          `Getter and setter for \`${name}\` are not adjacent. Place them next to each other.`,
          sourceCode,
          'Move the getter and setter so they appear consecutively in the class body.',
        )
      }
    }
    return null
  },
}
