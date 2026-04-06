import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUseBitCountVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/use-bit-count',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    // Detect bin(x).count("1")
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const attr = fn.childForFieldName('attribute')
    if (!attr || attr.text !== 'count') return null

    const obj = fn.childForFieldName('object')
    if (!obj || obj.type !== 'call') return null

    const innerFn = obj.childForFieldName('function')
    if (!innerFn || innerFn.type !== 'identifier' || innerFn.text !== 'bin') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const countArg = args.namedChildren[0]
    if (!countArg || countArg.type !== 'string') return null
    if (countArg.text !== '"1"' && countArg.text !== "'1'") return null

    const binArgs = obj.childForFieldName('arguments')
    const binArg = binArgs?.namedChildren[0]?.text ?? 'x'

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Use int.bit_count()',
      `\`bin(${binArg}).count("1")\` should use \`${binArg}.bit_count()\` (Python 3.10+) — cleaner and faster.`,
      sourceCode,
      `Replace with \`${binArg}.bit_count()\`.`,
    )
  },
}
