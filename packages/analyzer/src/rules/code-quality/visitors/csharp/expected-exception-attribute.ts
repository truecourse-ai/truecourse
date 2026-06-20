import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { csharpFindAttribute } from './_attr-helpers.js'

/**
 * `[ExpectedException]` (MSTest) marks a whole test method as expected to throw,
 * but it cannot assert *which* statement threw — any earlier failure that
 * happens to throw the same type makes the test pass for the wrong reason. The
 * modern, precise replacement is `Assert.Throws<T>(() => …)`. The check fires on
 * a `method_declaration` carrying an `[ExpectedException]` attribute.
 */
const NAMES = new Set(['ExpectedException'])

export const csharpExpectedExceptionAttributeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/expected-exception-attribute',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    const attr = csharpFindAttribute(node, NAMES)
    if (!attr) return null

    return makeViolation(
      this.ruleKey, attr, filePath, 'low',
      '[ExpectedException] should not be used',
      'The `[ExpectedException]` test attribute cannot assert which statement threw; use `Assert.Throws` instead.',
      sourceCode,
      'Replace `[ExpectedException]` with an `Assert.Throws<T>(() => …)` call around the statement under test.',
    )
  },
}
