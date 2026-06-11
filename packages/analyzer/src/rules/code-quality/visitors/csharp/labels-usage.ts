import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `goto label` — unstructured control flow. `goto case` / `goto default`
 * inside a switch are excluded: they are C#'s sanctioned replacement for
 * fall-through and don't jump to arbitrary labels.
 */
export const csharpLabelsUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/labels-usage',
  languages: ['csharp'],
  nodeTypes: ['goto_statement'],
  visit(node, filePath, sourceCode) {
    // `goto case 2;` / `goto default;` carry a `case` / `default` keyword child.
    if (node.children.some((c) => c?.type === 'case' || c?.type === 'default')) return null

    const label = node.namedChildren.find((c) => c?.type === 'identifier')?.text ?? 'label'
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'goto statement',
      `\`goto ${label}\` makes control flow hard to follow. Refactor using loops, helper methods, or early returns.`,
      sourceCode,
      'Restructure the logic with loops/methods so the `goto` and its label can be removed.',
    )
  },
}
