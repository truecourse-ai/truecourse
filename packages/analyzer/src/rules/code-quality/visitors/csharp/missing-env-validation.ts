import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'

/**
 * `Environment.GetEnvironmentVariable("X").Member` — dereferencing the raw
 * result, which is null whenever the variable is unset, throws NRE at
 * startup on any misconfigured machine.
 *
 * Not flagged (each is an explicit handling choice, and `Parse(GetEnv(…))`
 * belongs to reliability/invalid-envvar-default):
 *   - `?.` — conditional access parses as a different node entirely;
 *   - `!` — the null-forgiving wrapper changes the receiver node type;
 *   - `?? "default"` — the read isn't the direct receiver anymore.
 */
export const csharpMissingEnvValidationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/missing-env-validation',
  languages: ['csharp'],
  nodeTypes: ['member_access_expression'],
  visit(node, filePath, sourceCode) {
    const receiver = node.childForFieldName('expression')
    if (receiver?.type !== 'invocation_expression') return null
    if (getCSharpMethodName(receiver) !== 'GetEnvironmentVariable') return null
    const envReceiver = getCSharpReceiver(receiver)
    if (envReceiver !== 'Environment' && !envReceiver.endsWith('.Environment')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Environment variable dereferenced without null check',
      '`Environment.GetEnvironmentVariable()` returns null when the variable is unset — dereferencing the result directly throws NullReferenceException on misconfigured environments.',
      sourceCode,
      'Coalesce or validate first: `(Environment.GetEnvironmentVariable("KEY") ?? throw new InvalidOperationException("KEY is required"))`, or use `?.` with a null fallback.',
    )
  },
}
