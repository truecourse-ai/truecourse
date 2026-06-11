import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const csharpCollapsibleIfVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/collapsible-if',
  languages: ['csharp'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('alternative')) return null

    const consequence = node.childForFieldName('consequence')
    if (!consequence || consequence.type !== 'block') return null

    if (consequence.namedChildCount !== 1) return null
    const innerIf = consequence.namedChildren[0]
    if (!innerIf || innerIf.type !== 'if_statement') return null
    if (innerIf.childForFieldName('alternative')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Collapsible if statements',
      'Nested if without else can be combined: `if (a && b) { … }`. This reduces nesting and improves readability.',
      sourceCode,
      'Combine the conditions with && into a single if statement.',
    )
  },
}
