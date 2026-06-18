import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { getCSharpChainRoot, isCSharpLoopScopedIdentifier, isInsideCSharpLoop } from './_helpers.js'

/**
 * `JsonSerializer.Serialize/Deserialize` (System.Text.Json) or
 * `JsonConvert.SerializeObject/DeserializeObject` (Newtonsoft) inside a loop,
 * applied to the SAME data every iteration. Per-item (de)serialization —
 * argument is the loop variable or otherwise loop-scoped — is legitimate and
 * skipped, mirroring the JS visitor.
 */
const JSON_RECEIVERS = new Set(['JsonSerializer', 'JsonConvert'])
const JSON_METHODS = new Set(['Serialize', 'Deserialize', 'SerializeObject', 'DeserializeObject'])

export const csharpJsonParseInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/json-parse-in-loop',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const method = getCSharpMethodName(node)
    if (!JSON_METHODS.has(method)) return null
    const receiver = getCSharpReceiver(node).split('.').pop() ?? ''
    if (!JSON_RECEIVERS.has(receiver)) return null

    if (!isInsideCSharpLoop(node)) return null

    // Skip when the payload changes per iteration.
    const first = getCSharpArguments(node)[0]
    if (first) {
      if (first.type === 'invocation_expression') return null
      if (first.type === 'element_access_expression') return null
      if (first.type === 'interpolated_string_expression') return null
      if (first.type === 'identifier' && isCSharpLoopScopedIdentifier(node, first.text)) return null
      if (first.type === 'member_access_expression') {
        const root = getCSharpChainRoot(first)
        if (root.type === 'identifier' && isCSharpLoopScopedIdentifier(node, root.text)) return null
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      `${receiver}.${method}() inside loop`,
      `${receiver}.${method}() re-processes the same data on every iteration. Move it outside the loop and reuse the result.`,
      sourceCode,
      `Hoist the ${receiver}.${method}() call above the loop and cache the result.`,
    )
  },
}
