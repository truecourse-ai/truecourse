import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const incorrectDictIteratorVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/incorrect-dict-iterator',
  languages: ['python'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const right = node.childForFieldName('right')
    if (!right || right.type !== 'call') return null

    const fn = right.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const attr = fn.childForFieldName('attribute')
    if (!attr) return null

    if (attr.text !== 'keys' && attr.text !== 'values') return null

    const obj = fn.childForFieldName('object')
    if (!obj) return null
    const dictName = obj.text

    // Check if the loop body accesses the dict with the key
    const body = node.childForFieldName('body')
    if (!body) return null

    const left = node.childForFieldName('left')
    if (!left) return null
    const iterVar = left.text

    const bodyText = body.text

    if (attr.text === 'keys') {
      // If iterating .keys() but body accesses dict[key], suggest .items()
      if (bodyText.includes(`${dictName}[${iterVar}]`)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Iterating .keys() but accessing values by key',
          `Iterating ${dictName}.keys() and accessing ${dictName}[${iterVar}] in the body. Use .items() to get both key and value directly.`,
          sourceCode,
          `Replace ${dictName}.keys() with ${dictName}.items() and destructure key, value.`,
        )
      }
    }

    return null
  },
}
