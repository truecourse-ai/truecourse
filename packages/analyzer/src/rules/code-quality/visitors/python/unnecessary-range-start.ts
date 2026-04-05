import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUnnecessaryRangeStartVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-range-start',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.text !== 'range') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argList = args.namedChildren
    // range(0, n) — exactly 2 args where first is 0
    if (argList.length !== 2) return null

    const first = argList[0]
    if (!first || first.type !== 'integer' || first.text !== '0') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Unnecessary range start',
      '`range(0, n)` — `0` is the default start and can be omitted.',
      sourceCode,
      `Replace with \`range(${argList[1]?.text})\`.`,
    )
  },
}
