import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const TRACE_METHODS = new Set(['Write', 'WriteLine'])

/**
 * `Trace.Write` / `Trace.WriteLine` route application messages through
 * `System.Diagnostics.Trace`, which has no levels, structure, or scopes — a
 * structured logging abstraction (`ILogger`) is the modern .NET choice
 * Matched on the `Trace.Write`/`Trace.WriteLine` member-access shape;
 * `TraceSource`/`Debug.Write` are out of scope.
 */
export const csharpTraceWriteUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/trace-write-usage',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression') return null
    if (fn.childForFieldName('expression')?.text !== 'Trace') return null
    const method = fn.childForFieldName('name')?.text ?? ''
    if (!TRACE_METHODS.has(method)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Trace.Write/WriteLine used for logging',
      `\`Trace.${method}\` routes application logging through \`System.Diagnostics.Trace\`, which has no levels or structure — use a logging abstraction such as \`ILogger\` instead.`,
      sourceCode,
      'Replace the `Trace.Write`/`Trace.WriteLine` call with a structured logger.',
    )
  },
}
