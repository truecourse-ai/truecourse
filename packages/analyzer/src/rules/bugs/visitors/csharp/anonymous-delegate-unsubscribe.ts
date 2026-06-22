import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `someEvent -= (s, e) => { … }` / `-= delegate { … }` — unsubscribing with a
 * lambda or anonymous method creates a brand-new delegate instance that is
 * not reference-equal to the one that was subscribed, so nothing is actually
 * removed and the handler keeps firing (and the subscriber leaks).
 *
 * Only the `-=` form is flagged: `+=` with a lambda is the normal way to
 * subscribe. A named method or field on the right-hand side is fine.
 */
export const csharpAnonymousDelegateUnsubscribeVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/anonymous-delegate-unsubscribe',
  languages: ['csharp'],
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    const operator = node.childForFieldName('operator')
    if (!operator || operator.text !== '-=') return null

    const right = node.childForFieldName('right')
    if (!right) return null
    if (right.type !== 'lambda_expression' && right.type !== 'anonymous_method_expression') {
      return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Anonymous delegate used to unsubscribe',
      'Unsubscribing an event with a lambda or anonymous method creates a new delegate instance that does not match the one that was subscribed, so the handler is never removed.',
      sourceCode,
      'Store the handler in a field or local and pass that same instance to both `+=` and `-=`.',
    )
  },
}
