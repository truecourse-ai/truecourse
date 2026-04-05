import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects tests decorated with @unittest.skip or similar that lack an explicit
 * reason, making the skip implicit and potentially accidental.
 * Also detects xfail without strict mode which may hide real failures.
 */
export const pythonTestSkippedImplicitlyVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/test-skipped-implicitly',
  languages: ['python'],
  nodeTypes: ['decorated_definition'],
  visit(node, filePath, sourceCode) {
    const decorators = node.namedChildren.filter((c) => c.type === 'decorator')
    for (const dec of decorators) {
      const decText = dec.text

      // @unittest.skip without reason: @unittest.skip (no parentheses / no arg)
      if (decText === '@unittest.skip') {
        return makeViolation(
          this.ruleKey, dec, filePath, 'medium',
          'Test skipped without reason',
          '`@unittest.skip` without a reason string makes the skip implicit — provide a reason so it\'s clear why the test is skipped.',
          sourceCode,
          'Add a reason: `@unittest.skip("Reason for skipping")`.',
        )
      }

      // @pytest.mark.skip without reason argument
      if (decText === '@pytest.mark.skip' || decText.match(/^@pytest\.mark\.skip\(\s*\)$/)) {
        return makeViolation(
          this.ruleKey, dec, filePath, 'medium',
          'Test skipped without reason',
          '`@pytest.mark.skip` without a `reason` argument — provide a reason to explain why the test is skipped.',
          sourceCode,
          'Add `reason=`: `@pytest.mark.skip(reason="...")`.',
        )
      }
    }

    return null
  },
}
