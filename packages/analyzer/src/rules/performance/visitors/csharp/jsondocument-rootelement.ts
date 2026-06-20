import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { getCSharpReceiverSimpleName } from './_helpers.js'

/**
 * `JsonDocument.Parse(json).RootElement` returns a `JsonElement` whose backing
 * `JsonDocument` is never disposed, so the pooled parse buffer leaks. When the
 * element is consumed inline, `JsonElement.Parse(json)` (or a `using` over the
 * document) is the correct shape. Matches `JsonDocument.Parse(...).RootElement`.
 */
export const csharpJsonDocumentRootElementVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/jsondocument-rootelement',
  languages: ['csharp'],
  nodeTypes: ['member_access_expression'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('name')?.text !== 'RootElement') return null

    const inner = node.childForFieldName('expression')
    if (inner?.type !== 'invocation_expression') return null
    if (getCSharpMethodName(inner) !== 'Parse') return null
    if (getCSharpReceiverSimpleName(inner) !== 'JsonDocument') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'JsonDocument.Parse().RootElement',
      'JsonDocument.Parse(...).RootElement yields a JsonElement whose backing JsonDocument is never disposed, leaking its pooled parse buffer. JsonElement.Parse(...) reads the value directly without that lifetime.',
      sourceCode,
      'Use JsonElement.Parse(...) for inline reads, or dispose the JsonDocument with a using statement.',
    )
  },
}
