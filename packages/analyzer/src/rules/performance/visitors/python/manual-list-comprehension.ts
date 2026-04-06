import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const manualListComprehensionVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/manual-list-comprehension',
  languages: ['python'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    // Check if the body is just a single .append() call (or block with one statement)
    const statements = body.namedChildren.filter((c) => c.type !== 'comment')
    if (statements.length !== 1) return null

    const stmt = statements[0]
    if (!stmt) return null

    // expression_statement > call > attribute with .append
    const expr = stmt.type === 'expression_statement' ? stmt.namedChildren[0] : stmt
    if (!expr || expr.type !== 'call') return null

    const fn = expr.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const attr = fn.childForFieldName('attribute')
    if (attr?.text !== 'append') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Manual loop appending instead of list comprehension',
      'For loop with a single .append() call can be replaced with a list comprehension for clarity and performance.',
      sourceCode,
      'Replace the loop with a list comprehension: result = [expr for item in iterable].',
    )
  },
}
