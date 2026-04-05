import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonSplitStaticStringVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/split-static-string',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    // Detect "static,string".split(",") — method call on a string literal
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const attr = fn.childForFieldName('attribute')
    if (!attr || attr.text !== 'split') return null

    const obj = fn.childForFieldName('object')
    if (!obj || obj.type !== 'string') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Split on static string',
      'Splitting a static string literal produces a known result at write time — use a list literal instead.',
      sourceCode,
      'Replace with a list literal containing the expected elements.',
    )
  },
}
