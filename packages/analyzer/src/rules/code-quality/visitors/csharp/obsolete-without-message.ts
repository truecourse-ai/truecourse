import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * An `[Obsolete]` attribute applied with no arguments deprecates a member
 * without telling callers what to use instead. A message is the only migration
 * guidance the compiler surfaces at the call site, so its absence leaves the
 * deprecation silent. The check fires on an `attribute` named `Obsolete` (or
 * `ObsoleteAttribute`) that carries no `attribute_argument_list`.
 */
export const csharpObsoleteWithoutMessageVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/obsolete-without-message',
  languages: ['csharp'],
  nodeTypes: ['attribute'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')?.text
    const simple = name?.split('.').pop()
    if (simple !== 'Obsolete' && simple !== 'ObsoleteAttribute') return null

    const args = node.namedChildren.find((c) => c?.type === 'attribute_argument_list')
    if (args && args.namedChildCount > 0) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Obsolete attribute without message',
      '`[Obsolete]` is applied without a message, so callers get no guidance on what to use instead.',
      sourceCode,
      'Add a message to `[Obsolete]` describing the replacement.',
    )
  },
}
