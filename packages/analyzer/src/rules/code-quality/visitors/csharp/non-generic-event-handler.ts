import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * An event declared with a hand-rolled non-generic delegate (`event
 * OrderHandler Changed;`) duplicates what `EventHandler<TEventArgs>` provides
 * for free: a strongly-typed `(sender, e)` signature without a bespoke
 * delegate type per event (S3908). The check targets an `event_field_declaration`
 * whose declared type is a *non-generic* identifier ending in `Handler`,
 * `EventHandler`, or `Delegate` (but not the BCL `EventHandler` itself) — the
 * naming convention for custom event delegates. Generic types and the BCL
 * `EventHandler`/`EventHandler<T>` are left alone.
 */

function delegateTypeNode(node: SyntaxNode): SyntaxNode | null {
  const decl = node.namedChildren.find((c) => c?.type === 'variable_declaration')
  return decl?.namedChildren[0] ?? null
}

export const csharpNonGenericEventHandlerVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/non-generic-event-handler',
  languages: ['csharp'],
  nodeTypes: ['event_field_declaration'],
  visit(node, filePath, sourceCode) {
    const type = delegateTypeNode(node)
    if (type?.type !== 'identifier') return null

    const name = type.text
    if (name === 'EventHandler') return null
    if (!/(EventHandler|Handler|Delegate)$/.test(name)) return null

    return makeViolation(
      this.ruleKey, type, filePath, 'low',
      'Non-generic event handler',
      `Event uses the custom non-generic delegate \`${name}\` where \`EventHandler<TEventArgs>\` would provide a strongly-typed \`(sender, e)\` signature without a bespoke delegate type (S3908).`,
      sourceCode,
      `Declare the event as \`EventHandler<TEventArgs>\` and remove the \`${name}\` delegate.`,
    )
  },
}
