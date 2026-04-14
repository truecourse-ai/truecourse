import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const filterFirstOverFindVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/filter-first-over-find',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['subscript_expression'],
  visit(node, filePath, sourceCode) {
    const index = node.childForFieldName('index')
    if (!index || index.text !== '0') return null

    const object = node.childForFieldName('object')
    if (!object || object.type !== 'call_expression') return null

    const fn = object.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (prop?.text !== 'filter') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'filter()[0] instead of find()',
      '`.filter(...)[0]` creates a full array to get one item. Use `.find(...)` instead.',
      sourceCode,
      'Replace `.filter(fn)[0]` with `.find(fn)`.',
    )
  },
}
