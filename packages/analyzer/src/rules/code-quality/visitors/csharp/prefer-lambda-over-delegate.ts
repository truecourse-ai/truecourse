import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * An anonymous method written with the `delegate(params){…}` keyword form is a
 * verbose ancestor of the lambda `(params) => {…}`. The lambda is shorter,
 * supports expression bodies, and is the conventional spelling. The check fires
 * on every `anonymous_method_expression`, which is exactly the `delegate {…}`
 * syntax (lambdas parse as `lambda_expression`).
 */
export const csharpPreferLambdaOverDelegateVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-lambda-over-delegate',
  languages: ['csharp'],
  nodeTypes: ['anonymous_method_expression'],
  visit(node, filePath, sourceCode) {
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Prefer lambda over anonymous-method delegate',
      'An anonymous method written as `delegate(…){…}` is the verbose form of a lambda `(…) => {…}`, which is clearer.',
      sourceCode,
      'Rewrite the `delegate {…}` anonymous method as a lambda `(…) => {…}`.',
    )
  },
}
