import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { enclosingFunctionText } from './_helpers.js'

/**
 * `UseDeveloperExceptionPage()` reachable in production: not wrapped in (or
 * near) an `IsDevelopment()` environment check. The developer exception page
 * leaks stack traces, source and configuration.
 */
const ENV_GUARD_PATTERN = /IsDevelopment|IsStaging|IsEnvironment|EnvironmentName/

export const csharpProductionDebugEnabledVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/production-debug-enabled',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpMethodName(node) !== 'UseDeveloperExceptionPage') return null

    // Guarded directly or via an early-return/inverted check anywhere in the
    // same method (or top-level program) — conservatively treat any
    // environment check in scope as a guard.
    if (ENV_GUARD_PATTERN.test(enclosingFunctionText(node))) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Production debug enabled',
      'UseDeveloperExceptionPage() is registered without an environment check — stack traces and internals leak in production.',
      sourceCode,
      'Wrap it in if (app.Environment.IsDevelopment()) { ... } and use UseExceptionHandler in production.',
    )
  },
}
