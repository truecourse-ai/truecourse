import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isInComparisonContext, lastSegment } from './_helpers.js'

/**
 * `BindingFlags.NonPublic` used as a value — reflection that reaches private or
 * internal members, bypassing the encapsulation and access checks the compiler
 * enforces. Comparisons (`if (flags == BindingFlags.NonPublic)`) are
 * inspection, not use, and are skipped.
 */
export const csharpReflectionBypassAccessibilityVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/reflection-bypass-accessibility',
  languages: ['csharp'],
  nodeTypes: ['member_access_expression'],
  visit(node, filePath, sourceCode) {
    const receiver = node.childForFieldName('expression')
    const name = node.childForFieldName('name')
    if (!receiver || !name) return null
    if (lastSegment(receiver.text) !== 'BindingFlags' || name.text !== 'NonPublic') return null
    if (isInComparisonContext(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Reflection bypasses member accessibility',
      'BindingFlags.NonPublic reaches private/internal members via reflection, bypassing encapsulation and the access checks the compiler enforces.',
      sourceCode,
      'Access members through their public API; if reflection is unavoidable, document and tightly scope it.',
    )
  },
}
