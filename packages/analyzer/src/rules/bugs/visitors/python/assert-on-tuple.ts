import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonAssertOnTupleVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/assert-on-tuple',
  languages: ['python'],
  nodeTypes: ['assert_statement'],
  visit(node, filePath, sourceCode) {
    // assert_statement children: assert <expr> [, <message>]
    // We look for the test expression being a tuple
    const testExpr = node.namedChildren[0]
    if (!testExpr) return null

    if (testExpr.type === 'tuple') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Assert on non-empty tuple',
        `\`assert (${testExpr.text})\` always passes because a non-empty tuple is truthy. Did you mean \`assert ${testExpr.namedChildren[0]?.text ?? testExpr.text}, ${testExpr.namedChildren[1]?.text ?? ''}\`?`,
        sourceCode,
        'Change to `assert condition, message` (no extra parentheses that create a tuple).',
      )
    }

    return null
  },
}
