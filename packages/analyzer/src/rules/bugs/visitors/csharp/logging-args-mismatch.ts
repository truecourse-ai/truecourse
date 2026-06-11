import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName, getCSharpStringText, isCSharpStringNode } from '../../../_shared/csharp-helpers.js'
import { isScalarLiteral, parseMessageTemplateHoles } from './_helpers.js'

/**
 * Microsoft.Extensions.Logging / Serilog message-template argument count
 * mismatch: `_logger.LogInformation("Loaded {Count} for {User}", count)` —
 * one hole is never filled (and extra args are silently dropped).
 *
 * Recall guards: templates with positional `{0}` holes or duplicate hole
 * names are skipped (different consumption semantics); a single non-literal
 * argument that could be a `params object[]` array suppresses the
 * missing-args case only.
 */
const LOG_METHODS = new Set([
  'LogTrace', 'LogDebug', 'LogInformation', 'LogWarning', 'LogError', 'LogCritical',
  'Information', 'Warning', 'Error', 'Debug', 'Verbose', 'Fatal', // Serilog
])

export const csharpLoggingArgsMismatchVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/logging-args-mismatch',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const method = getCSharpMethodName(node)
    if (!LOG_METHODS.has(method)) return null

    const args = getCSharpArguments(node)
    if (args.length === 0) return null

    // Template = first string literal among the first three args
    // (EventId and/or Exception may precede it).
    let fmtIndex = -1
    for (let i = 0; i < Math.min(3, args.length); i++) {
      const arg: SyntaxNode = args[i]!
      if (isCSharpStringNode(arg) && arg.type !== 'interpolated_string_expression') {
        fmtIndex = i
        break
      }
      // Anything string-shaped before the template (e.g. concatenation)
      // makes the template position ambiguous — bail.
      if (arg.type === 'binary_expression') return null
    }
    if (fmtIndex === -1) return null

    const fmt = getCSharpStringText(args[fmtIndex]!)
    if (fmt === null) return null

    const holes = parseMessageTemplateHoles(fmt)
    if (holes === null) return null
    if (new Set(holes).size !== holes.length) return null // duplicate names: positional semantics get murky

    const valueArgs = args.slice(fmtIndex + 1)
    if (valueArgs.length === holes.length) return null

    // Missing args could be explained by one params object[] array argument.
    if (valueArgs.length === 1 && holes.length > 1 && !isScalarLiteral(valueArgs[0]!)) return null

    const detail = valueArgs.length > holes.length
      ? `the extra argument${valueArgs.length - holes.length !== 1 ? 's are' : ' is'} silently dropped`
      : `the unfilled hole${holes.length - valueArgs.length !== 1 ? 's render' : ' renders'} as the literal placeholder text`

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Logging template args mismatch',
      `The message template has ${holes.length} placeholder${holes.length !== 1 ? 's' : ''} (${holes.map((h) => `{${h}}`).join(', ')}) but ${valueArgs.length} argument${valueArgs.length !== 1 ? 's were' : ' was'} provided — ${detail}.`,
      sourceCode,
      'Pass exactly one argument per template placeholder, in order.',
    )
  },
}
