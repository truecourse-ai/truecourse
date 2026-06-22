import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Allocating `new EventArgs()` on every event raise creates a throwaway object
 * that carries no data. The shared `EventArgs.Empty` singleton is the canonical
 * no-data payload and avoids the allocation. The check fires on an
 * `object_creation_expression` constructing exactly `EventArgs` with no
 * arguments (a derived `…EventArgs` with real data is left alone).
 */
export const csharpUseEventArgsEmptyVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/use-eventargs-empty',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression'],
  visit(node, filePath, sourceCode) {
    const typeName = node.childForFieldName('type')?.text ?? node.namedChildren[0]?.text
    if ((typeName?.split('.').pop()) !== 'EventArgs') return null

    const args = node.namedChildren.find((c) => c?.type === 'argument_list')
    if (args && args.namedChildCount > 0) return null

    // An object initializer means the caller is setting state, not raising a
    // no-data event.
    if (node.namedChildren.some((c) => c?.type === 'initializer_expression')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Use EventArgs.Empty instead of new EventArgs()',
      '`new EventArgs()` allocates a throwaway no-data object on every raise; `EventArgs.Empty` is the shared canonical payload.',
      sourceCode,
      'Replace `new EventArgs()` with `EventArgs.Empty`.',
    )
  },
}
