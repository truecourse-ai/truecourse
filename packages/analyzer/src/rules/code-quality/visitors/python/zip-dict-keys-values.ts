import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonZipDictKeysValuesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/zip-dict-keys-values',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    // Detect zip(d.keys(), d.values())
    const fn = node.childForFieldName('function')
    if (!fn || fn.text !== 'zip') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argList = args.namedChildren
    if (argList.length !== 2) return null

    const [arg1, arg2] = argList
    if (!arg1 || !arg2) return null
    if (arg1.type !== 'call' || arg2.type !== 'call') return null

    const fn1 = arg1.childForFieldName('function')
    const fn2 = arg2.childForFieldName('function')

    if (!fn1 || !fn2 || fn1.type !== 'attribute' || fn2.type !== 'attribute') return null

    const attr1 = fn1.childForFieldName('attribute')
    const attr2 = fn2.childForFieldName('attribute')

    if (attr1?.text !== 'keys' || attr2?.text !== 'values') return null

    const dict1 = fn1.childForFieldName('object')?.text
    const dict2 = fn2.childForFieldName('object')?.text

    if (!dict1 || !dict2 || dict1 !== dict2) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Zip dict keys and values',
      `\`zip(${dict1}.keys(), ${dict1}.values())\` should be \`${dict1}.items()\`.`,
      sourceCode,
      `Replace with \`${dict1}.items()\`.`,
    )
  },
}
