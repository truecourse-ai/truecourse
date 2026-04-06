import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const collapsibleIfVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/collapsible-if',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const hasElse = node.children.some((c) => c.type === 'else_clause')
    if (hasElse) return null

    const consequence = node.childForFieldName('consequence')
    if (!consequence || consequence.type !== 'statement_block') return null

    const namedChildren = consequence.namedChildren
    if (namedChildren.length !== 1) return null
    const innerIf = namedChildren[0]
    if (innerIf.type !== 'if_statement') return null

    const innerHasElse = innerIf.children.some((c) => c.type === 'else_clause')
    if (innerHasElse) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Collapsible if statements',
      'Nested if without else can be combined: `if (a && b) { ... }`. This reduces nesting and improves readability.',
      sourceCode,
      'Combine the conditions with && into a single if statement.',
    )
  },
}
