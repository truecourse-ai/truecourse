import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `throw new NotImplementedException()` marks code that is deliberately
 * unfinished. It is a placeholder that must never ship: a caller reaching it
 * gets a runtime crash rather than a missing-feature signal at build time.
 * Tracking every occurrence keeps the stubs visible. The check fires on a
 * `throw_statement` (or `throw_expression`) constructing `NotImplementedException`.
 */
export const csharpNotImplementedExceptionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/not-implemented-exception',
  languages: ['csharp'],
  nodeTypes: ['throw_statement', 'throw_expression'],
  visit(node, filePath, sourceCode) {
    const creation = node.namedChildren.find((c) => c?.type === 'object_creation_expression')
    if (!creation) return null
    const typeName = creation.childForFieldName('type')?.text ?? creation.namedChildren[0]?.text
    if ((typeName?.split('.').pop()) !== 'NotImplementedException') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'NotImplementedException thrown',
      '`throw new NotImplementedException()` marks unfinished code that must not ship.',
      sourceCode,
      'Implement the member or track the work before release.',
    )
  },
}
