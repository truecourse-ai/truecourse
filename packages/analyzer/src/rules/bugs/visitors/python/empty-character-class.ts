import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonEmptyCharacterClassVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/empty-character-class',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Match re.compile(), re.search(), re.match(), re.findall(), etc.
    let iReCall = false
    if (fn.type === 'attribute') {
      const obj = fn.childForFieldName('object')
      const attr = fn.childForFieldName('attribute')
      if (obj?.text === 're' && attr) iReCall = true
    }
    if (!iReCall) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg || firstArg.type !== 'string') return null

    const patternText = firstArg.text
    const regex = /(?:^|[^\\])\[\]/
    if (regex.test(patternText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Empty character class in regex',
        'Empty character class `[]` in regex never matches anything.',
        sourceCode,
        'Add characters to the character class or remove it.',
      )
    }
    return null
  },
}
