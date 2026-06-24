import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Primitive parsers that all gained a ReadOnlySpan<char> overload — so an AsSpan
// slice reaches them without the intermediate string Substring allocates.
const SPAN_PARSERS = new Set([
  'int', 'long', 'short', 'byte', 'sbyte', 'uint', 'ulong', 'ushort',
  'double', 'float', 'decimal', 'nint', 'nuint',
  'Int16', 'Int32', 'Int64', 'UInt16', 'UInt32', 'UInt64',
  'Single', 'Double', 'Decimal', 'Byte', 'SByte',
])
const PARSE_METHODS = new Set(['Parse', 'TryParse'])

/**
 * A <c>Substring(...)</c> whose result is handed straight to a primitive
 * <c>Parse</c>/<c>TryParse</c>. <c>Substring</c> allocates and copies a new string
 * only to be thrown away after parsing; every primitive parser accepts a
 * <c>ReadOnlySpan&lt;char&gt;</c>, so <c>str.AsSpan(start, length)</c> parses the
 * same characters with no allocation (CA1846). Scoped to that exact consumer so it
 * never fires on a Substring whose result is genuinely needed as a string.
 */
export const csharpPreferAsSpanOverSubstringVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/prefer-asspan-over-substring',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression' || fn.childForFieldName('name')?.text !== 'Substring') return null

    // The Substring call must be an argument to a primitive Parse/TryParse.
    const arg = node.parent
    if (arg?.type !== 'argument') return null
    const outer = arg.parent?.parent
    if (outer?.type !== 'invocation_expression') return null
    const outerFn = outer.childForFieldName('function')
    if (outerFn?.type !== 'member_access_expression') return null
    if (!PARSE_METHODS.has(outerFn.childForFieldName('name')?.text ?? '')) return null
    const parserType = outerFn.childForFieldName('expression')?.text ?? ''
    if (!SPAN_PARSERS.has(parserType.split('.').pop() ?? '')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Prefer AsSpan over Substring before parsing',
      `Substring allocates a throwaway string here; ${parserType}.${outerFn.childForFieldName('name')?.text} accepts a ReadOnlySpan<char>, so AsSpan parses the same slice without allocating.`,
      sourceCode,
      'Replace .Substring(start, length) with .AsSpan(start, length).',
    )
  },
}
