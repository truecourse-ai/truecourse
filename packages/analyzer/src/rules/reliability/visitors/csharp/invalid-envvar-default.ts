import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { simpleTypeName } from './_helpers.js'

/**
 * C# adaptation of the env-var-default rule. C# has no default parameter on
 * the read (`Environment.GetEnvironmentVariable` returns null when unset), so
 * the type-mismatch defect surfaces one step later: feeding the result
 * straight into `X.Parse(...)`, which throws ArgumentNullException at startup
 * the moment the variable is missing.
 *
 * Not flagged:
 *   - `… ?? "default"` between the read and the parse (the C# spelling of a
 *     proper default);
 *   - `Environment.GetEnvironmentVariable("X")!` — the null-forgiving
 *     operator is an explicit fail-fast assertion for required config;
 *   - `TryParse` (doesn't throw);
 *   - `Convert.To*` (returns the type's default for null instead of throwing).
 */
const PARSE_RECEIVERS = new Set([
  'int', 'uint', 'long', 'ulong', 'short', 'ushort', 'byte', 'sbyte',
  'double', 'float', 'decimal', 'bool',
  'Guid', 'DateTime', 'DateTimeOffset', 'TimeSpan', 'Enum', 'Uri', 'Version',
])

export const csharpInvalidEnvVarDefaultVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/invalid-envvar-default',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpMethodName(node) !== 'GetEnvironmentVariable') return null
    if (simpleTypeName(getCSharpReceiver(node)) !== 'Environment') return null

    // The env read must be a direct argument of the parse call — any wrapper
    // (`?? "8080"`, `!`, `.Trim()`) means the author handled or asserted it.
    const arg = node.parent
    if (arg?.type !== 'argument') return null
    const argList = arg.parent
    if (argList?.type !== 'argument_list') return null
    const outer = argList.parent
    if (outer?.type !== 'invocation_expression') return null

    if (getCSharpMethodName(outer) !== 'Parse') return null
    const parseReceiver = simpleTypeName(getCSharpReceiver(outer))
    if (!PARSE_RECEIVERS.has(parseReceiver)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Environment variable parsed without a default',
      `Environment.GetEnvironmentVariable() returns null when the variable is unset, and ${parseReceiver}.Parse(null) throws ArgumentNullException.`,
      sourceCode,
      `Coalesce to a string default before parsing — ${parseReceiver}.Parse(Environment.GetEnvironmentVariable("KEY") ?? "<default>") — or use ${parseReceiver}.TryParse.`,
    )
  },
}
