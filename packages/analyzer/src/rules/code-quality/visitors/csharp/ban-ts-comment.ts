import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `#pragma warning disable` without a justification — the C# form of
 * `@ts-ignore` without a description. A suppression is acceptable when it
 * explains itself: a trailing comment on the same line, or a comment on the
 * line directly above.
 */
export const csharpBanTsCommentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/ban-ts-comment',
  languages: ['csharp'],
  nodeTypes: ['preproc_pragma'],
  visit(node, filePath, sourceCode) {
    const keywords = node.children.map((c) => c?.type)
    if (!keywords.includes('warning') || !keywords.includes('disable')) return null

    // Trailing comment on the same line parses as a child of the pragma.
    if (node.children.some((c) => c?.type === 'comment')) return null

    // Comment on the line directly above.
    const prev = node.previousSibling
    if (prev?.type === 'comment' && prev.endPosition.row === node.startPosition.row - 1) return null

    const codes = node.children
      .filter((c) => c?.isNamed && c.type === 'identifier')
      .map((c) => c!.text)
    const what = codes.length > 0 ? codes.join(', ') : 'all warnings'

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      '#pragma warning disable without justification',
      `\`#pragma warning disable\` suppresses ${what} without explaining why. Add a reason.`,
      sourceCode,
      'Add a comment explaining why the warning is suppressed, e.g. `#pragma warning disable CA1031 // top-level handler must not crash the worker`.',
    )
  },
}
