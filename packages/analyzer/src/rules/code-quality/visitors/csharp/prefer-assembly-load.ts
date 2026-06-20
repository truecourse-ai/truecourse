import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'

/**
 * `Assembly.LoadFrom` / `Assembly.LoadFile` load into the "load-from" binding
 * context, whose quirks produce subtle type-identity bugs (two `Type` objects
 * for the same type, failed casts). `Assembly.Load` uses the default context
 * and is the safe default (S3885). The check fires on an `Assembly.LoadFrom`
 * or `Assembly.LoadFile` call.
 */
const FLAGGED = new Set(['LoadFrom', 'LoadFile'])

export const csharpPreferAssemblyLoadVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-assembly-load',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const method = getCSharpMethodName(node)
    if (!FLAGGED.has(method)) return null
    if (getCSharpReceiver(node) !== 'Assembly') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Assembly.LoadFrom/LoadFile should be Assembly.Load',
      `\`Assembly.${method}\` uses the load-from binding context, whose quirks cause subtle type-identity bugs — prefer \`Assembly.Load\`.`,
      sourceCode,
      'Use `Assembly.Load` with the assembly name instead.',
    )
  },
}
