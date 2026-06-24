import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** Static parse methods on the date/time types whose single-argument overload is culture-dependent. */
const PARSE_TARGETS: Record<string, Set<string>> = {
  DateTime: new Set(['Parse', 'ParseExact', 'TryParse', 'TryParseExact']),
  DateTimeOffset: new Set(['Parse', 'ParseExact', 'TryParse', 'TryParseExact']),
  DateOnly: new Set(['Parse', 'ParseExact', 'TryParse', 'TryParseExact']),
  TimeOnly: new Set(['Parse', 'ParseExact', 'TryParse', 'TryParseExact']),
}

/**
 * `DateTime.Parse(text)` with no IFormatProvider — the string is interpreted
 * using the ambient current culture, so the same input parses differently (or
 * throws) on machines with different locale settings. An explicit
 * IFormatProvider such as CultureInfo.InvariantCulture makes parsing portable.
 *
 * Only the static `Type.Parse(...)`-style call with a single (string) argument
 * is flagged; any overload already passing a provider has 2+ arguments.
 */
export const csharpDateTimeParseNoFormatProviderVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/datetime-parse-no-format-provider',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression') return null

    const target = fn.childForFieldName('expression') as SyntaxNode | null
    if (!target || target.type !== 'identifier') return null
    const methods = PARSE_TARGETS[target.text]
    if (!methods) return null
    const method = fn.childForFieldName('name')?.text
    if (!method || !methods.has(method)) return null

    const args = node.childForFieldName('arguments')?.namedChildren.filter((c) => c?.type === 'argument') ?? []
    if (args.length !== 1) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      `${target.text}.${method} without a format provider`,
      `\`${target.text}.${method}\` is called without an IFormatProvider, so the value is parsed with the current culture and may fail or be misread on other locales.`,
      sourceCode,
      'Pass an explicit IFormatProvider such as CultureInfo.InvariantCulture.',
    )
  },
}
