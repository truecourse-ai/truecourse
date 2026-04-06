import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonReadlinesInForVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/readlines-in-for',
  languages: ['python'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const right = node.childForFieldName('right')
    if (!right || right.type !== 'call') return null

    const fn = right.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const attr = fn.childForFieldName('attribute')
    if (attr?.text !== 'readlines') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'readlines() in for loop',
      '`file.readlines()` loads the entire file into memory before iterating. The file object itself is iterable — iterate over it directly.',
      sourceCode,
      'Replace `for line in file.readlines():` with `for line in file:` — this is lazy and memory-efficient.',
    )
  },
}
