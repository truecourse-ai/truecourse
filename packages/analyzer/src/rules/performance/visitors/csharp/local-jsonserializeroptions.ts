import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { getCSharpReceiverSimpleName, getCSharpSimpleTypeName } from './_helpers.js'

/**
 * Constructing a `new JsonSerializerOptions(...)` inline at each
 * `JsonSerializer.Serialize`/`Deserialize` call defeats the per-options
 * metadata cache: every call re-resolves and re-caches the type converters.
 * The options should be built once and reused (a static field). Fires when a
 * `JsonSerializer.Serialize`/`Deserialize` call receives a freshly
 * constructed options object as an argument.
 */
const SERIALIZE_METHODS = new Set(['Serialize', 'Deserialize', 'SerializeToUtf8Bytes', 'SerializeAsync', 'DeserializeAsync'])

export const csharpLocalJsonSerializerOptionsVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/local-jsonserializeroptions',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (!SERIALIZE_METHODS.has(getCSharpMethodName(node))) return null
    if (getCSharpReceiverSimpleName(node) !== 'JsonSerializer') return null

    const inlineOptions = getCSharpArguments(node).find(
      (arg) =>
        arg.type === 'object_creation_expression' &&
        getCSharpSimpleTypeName(arg.childForFieldName('type')) === 'JsonSerializerOptions',
    )
    if (!inlineOptions) return null

    return makeViolation(
      this.ruleKey, inlineOptions, filePath, 'medium',
      'Local JsonSerializerOptions instance',
      'Constructing a new JsonSerializerOptions at each serialize/deserialize call defeats the per-options metadata cache, so every call re-resolves and re-caches the type converters.',
      sourceCode,
      'Build the JsonSerializerOptions once (e.g. a static readonly field) and reuse the same instance across calls.',
    )
  },
}
