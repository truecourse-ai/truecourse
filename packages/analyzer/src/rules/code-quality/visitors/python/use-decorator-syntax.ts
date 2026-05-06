import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUseDecoratorSyntaxVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/use-decorator-syntax',
  languages: ['python'],
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    // Detect: method = classmethod(method) or method = staticmethod(method)
    const expr = node.namedChildren[0]
    if (!expr || expr.type !== 'assignment') return null

    const right = expr.childForFieldName('right')
    if (!right || right.type !== 'call') return null

    const fn = right.childForFieldName('function')
    if (!fn || fn.type !== 'identifier') return null

    if (fn.text !== 'classmethod' && fn.text !== 'staticmethod') return null

    // The decorator-rewrite is only equivalent when the wrapped value is
    // a SIMPLE identifier matching the LHS variable name:
    //   `foo = staticmethod(foo)` → `@staticmethod\ndef foo(...): …`
    //
    // When the argument is itself a call (`staticmethod(with_http_client(_create_team))`)
    // or a different identifier (`foo = staticmethod(_internal_foo)`), the
    // decorator form would lose the wrapping or rename and is NOT a
    // mechanical rewrite. Skip.
    const left = expr.childForFieldName('left')
    const lhsName = left?.type === 'identifier' ? left.text : null
    const args = right.childForFieldName('arguments')
    const firstArg = args?.namedChildren.find((c) => c.type !== 'comment')
    if (!firstArg || firstArg.type !== 'identifier') return null
    if (lhsName && firstArg.text !== lhsName) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `Use @${fn.text} decorator`,
      `Use the \`@${fn.text}\` decorator syntax instead of calling \`${fn.text}()\` directly.`,
      sourceCode,
      `Add \`@${fn.text}\` decorator to the function definition instead.`,
    )
  },
}
