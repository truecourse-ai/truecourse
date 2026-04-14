import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CASE_TERMINATORS, JS_LANGUAGES } from './_helpers.js'

export const fallthroughCaseVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/fallthrough-case',
  languages: JS_LANGUAGES,
  nodeTypes: ['switch_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const cases = body.namedChildren.filter((c) => c.type === 'switch_case')

    for (let i = 0; i < cases.length - 1; i++) {
      const caseNode = cases[i]
      const statements = caseNode.namedChildren.filter(
        (c) => c.type !== 'comment' && c !== caseNode.childForFieldName('value'),
      )

      // Empty case body (intentional grouping) — skip
      if (statements.length === 0) continue

      // Check if the last statement is a terminator
      const last = statements[statements.length - 1]
      if (!last || CASE_TERMINATORS.has(last.type)) continue

      // Check if last statement is a block containing a terminator
      if (last.type === 'statement_block') {
        const blockChildren = last.namedChildren.filter((c) => c.type !== 'comment')
        const blockLast = blockChildren[blockChildren.length - 1]
        if (blockLast && CASE_TERMINATORS.has(blockLast.type)) continue
      }

      return makeViolation(
        this.ruleKey, caseNode, filePath, 'medium',
        'Switch case fallthrough',
        'This case does not end with break, return, or throw — it falls through to the next case.',
        sourceCode,
        'Add a break, return, or throw statement, or add a // falls through comment if intentional.',
      )
    }
    return null
  },
}
