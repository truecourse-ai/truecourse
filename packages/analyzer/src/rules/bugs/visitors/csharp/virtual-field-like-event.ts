import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A `virtual` field-like event (`public virtual event EventHandler X;`).
 * Overriding a field-like event creates a second, separate backing delegate in
 * the derived type: `base`'s subscribers and the override's subscribers live in
 * different fields, so raising one does not notify the other — subscription
 * semantics silently break. Events that need polymorphism should use explicit
 * add/remove accessors instead of the field-like form.
 */
export const csharpVirtualFieldLikeEventVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/virtual-field-like-event',
  languages: ['csharp'],
  nodeTypes: ['event_field_declaration'],
  visit(node, filePath, sourceCode) {
    const isVirtual = node.children.some((c) => c?.type === 'modifier' && c.text === 'virtual')
    if (!isVirtual) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Virtual field-like event',
      'Overriding this virtual field-like event creates a separate backing delegate in the derived type, so base and derived subscribers are notified independently.',
      sourceCode,
      'Use an event with explicit add/remove accessors instead of a virtual field-like event.',
    )
  },
}
