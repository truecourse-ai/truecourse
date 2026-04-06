import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonDictGetNoneDefaultVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/dict-get-none-default',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null
    const attr = fn.childForFieldName('attribute')
    if (!attr || attr.text !== 'get') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null
    const positional = args.namedChildren.filter((a) => a.type !== 'keyword_argument')

    // dict.get(key, None) — None is default
    if (positional.length !== 2) return null
    const defaultArg = positional[1]
    if (!defaultArg || defaultArg.text !== 'None') return null

    const obj = fn.childForFieldName('object')
    const objText = obj?.text || 'dict'
    const keyText = positional[0].text

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'dict.get() with explicit None default',
      `\`${objText}.get(${keyText}, None)\` — \`None\` is already the default, remove it.`,
      sourceCode,
      `Replace with \`${objText}.get(${keyText})\`.`,
    )
  },
}
