import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const noVoidVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-void',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['unary_expression'],
  visit(node, filePath, sourceCode) {
    const operator = node.children[0]
    if (operator?.text !== 'void') return null
    const operand = node.children[1]
    if (operand?.text === '0') return null

    // Allow `void <expr>` as a fire-and-forget pattern: a statement on its own,
    // or the direct body of an arrow function (e.g. `onClick={() => void f()}`).
    // These are the idiomatic ways to discard a Promise in a sync callback or
    // top-level/module context. Only flag `void` when used as a value
    // (return, ternary, binary, sequence, variable init, argument, etc.).
    const parent = node.parent
    if (parent?.type === 'expression_statement') return null
    if (parent?.type === 'arrow_function') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Void expression',
      'The `void` operator is confusing. Use `undefined` directly or omit the return value.',
      sourceCode,
      'Replace `void expr` with `undefined` or remove the expression.',
    )
  },
}
