import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Listing `object` in a base list is redundant: every type already derives from
 * `System.Object`. The explicit base only adds noise. The check looks for a
 * `predefined_type` whose text is `object` directly in a type's `base_list`.
 */
export const csharpRedundantBaseTypeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-base-type',
  languages: ['csharp'],
  nodeTypes: ['base_list'],
  visit(node, filePath, sourceCode) {
    const objectBase = node.namedChildren.find(
      (c) => c?.type === 'predefined_type' && c.text === 'object',
    )
    if (!objectBase) return null

    return makeViolation(
      this.ruleKey, objectBase, filePath, 'low',
      'Redundant base type',
      'Every type already derives from `object`, so naming it in the base list is redundant.',
      sourceCode,
      'Remove `object` from the base list.',
    )
  },
}
