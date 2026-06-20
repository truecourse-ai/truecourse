import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `#pragma warning disable` silences a compiler/analyzer diagnostic inline. The
 * suppression is legitimate but should stay visible so a silenced diagnostic is
 * never forgotten. The check fires on a `#pragma warning disable` directive (not
 * the matching `restore`, which re-enables and is not a suppression).
 *
 * `[SuppressMessage]`-attribute suppressions are tracked by
 * `suppression-without-justification`, so this rule scopes to pragma directives
 * to avoid double-reporting the same suppression.
 */
export const csharpInSourceSuppressionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/in-source-suppression',
  languages: ['csharp'],
  nodeTypes: ['preproc_pragma'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    if (!/^#pragma\s+warning\s+disable\b/.test(text)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'In-source issue suppression',
      'A `#pragma warning disable` suppresses a diagnostic inline — tracked so the silenced warning stays visible.',
      sourceCode,
      'Confirm the suppression is intentional and scoped, and pair it with a `#pragma warning restore`.',
    )
  },
}
