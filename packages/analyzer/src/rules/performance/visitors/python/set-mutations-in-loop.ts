import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const setMutationsInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/set-mutations-in-loop',
  languages: ['python'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    // Check if the body is just a single .add() call
    const statements = body.namedChildren.filter((c) => c.type !== 'comment')
    if (statements.length !== 1) return null

    const stmt = statements[0]
    if (!stmt) return null

    const expr = stmt.type === 'expression_statement' ? stmt.namedChildren[0] : stmt
    if (!expr || expr.type !== 'call') return null

    const fn = expr.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const attr = fn.childForFieldName('attribute')
    if (attr?.text !== 'add') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'set.add() in loop instead of set update',
      'Calling set.add() in a loop with a single element can be replaced with set.update() or a set comprehension.',
      sourceCode,
      'Use my_set.update(iterable) or my_set = {expr for item in iterable} instead.',
    )
  },
}
