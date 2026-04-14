import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonCollapsibleIfVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/collapsible-if',
  languages: ['python'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    // Check: if a:\n    if b:\n        ... with no else/elif on either
    const hasElse = node.children.some((c) => c.type === 'else_clause' || c.type === 'elif_clause')
    if (hasElse) return null

    const body = node.childForFieldName('consequence')
    if (!body || body.type !== 'block') return null

    const namedChildren = body.namedChildren
    if (namedChildren.length !== 1) return null
    const innerIf = namedChildren[0]
    if (innerIf.type !== 'if_statement') return null

    const innerHasElse = innerIf.children.some((c) => c.type === 'else_clause' || c.type === 'elif_clause')
    if (innerHasElse) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Collapsible if statements',
      'Nested if without else can be combined: `if a and b:`. This reduces nesting and improves readability.',
      sourceCode,
      'Combine the conditions with `and` into a single if statement.',
    )
  },
}
