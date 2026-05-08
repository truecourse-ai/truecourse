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

    // Skip if either condition is already multi-line / compound.
    // Merging two long compound conditions with && produces a
    // single expression with 3+ binary expressions across multiple
    // lines that's harder to read than the nested form.
    const outerCond = node.childForFieldName('condition')
    const innerCond = innerIf.childForFieldName('condition')
    function isComplexCondition(c: import('web-tree-sitter').Node | null): boolean {
      if (!c) return false
      // Multi-line.
      if (c.endPosition.row > c.startPosition.row) return true
      // 3+ logical operators in the condition (counting && / ||).
      const text = c.text
      const opCount = (text.match(/&&|\|\|/g) ?? []).length
      if (opCount >= 3) return true
      return false
    }
    if (isComplexCondition(outerCond) || isComplexCondition(innerCond)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Collapsible if statements',
      'Nested if without else can be combined: `if (a && b) { ... }`. This reduces nesting and improves readability.',
      sourceCode,
      'Combine the conditions with && into a single if statement.',
    )
  },
}
