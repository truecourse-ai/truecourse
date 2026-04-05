import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonInDictKeysVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/in-dict-keys',
  languages: ['python'],
  nodeTypes: ['comparison_operator'],
  visit(node, filePath, sourceCode) {
    // Pattern: key in dict.keys()
    const children = node.children
    const inIdx = children.findIndex((c) => c.type === 'in')
    if (inIdx === -1) return null

    const rightNode = node.namedChildren[node.namedChildren.length - 1]
    if (!rightNode || rightNode.type !== 'call') return null

    const fn = rightNode.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null
    const attr = fn.childForFieldName('attribute')
    if (!attr || attr.text !== 'keys') return null

    const args = rightNode.childForFieldName('arguments')
    if (args && args.namedChildren.length > 0) return null // .keys() should have no args

    const obj = fn.childForFieldName('object')
    const objText = obj?.text || 'dict'

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Unnecessary .keys() in membership test',
      `\`key in ${objText}.keys()\` — \`.keys()\` is redundant, use \`key in ${objText}\` instead.`,
      sourceCode,
      `Replace \`${objText}.keys()\` with just \`${objText}\`.`,
    )
  },
}
