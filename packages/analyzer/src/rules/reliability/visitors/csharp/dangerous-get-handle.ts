import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'

/**
 * `SafeHandle.DangerousGetHandle()` returns the raw OS handle bypassing the
 * SafeHandle's reference counting. If the SafeHandle is collected (or disposed)
 * while the raw value is still in use, the handle is closed underneath the
 * caller and the value dangles. The method name is unambiguous, so matching the
 * call by name is precise without type resolution.
 */
export const csharpDangerousGetHandleVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/dangerous-get-handle',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpMethodName(node) !== 'DangerousGetHandle') return null
    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'DangerousGetHandle called',
      'DangerousGetHandle() extracts the raw handle without incrementing the SafeHandle reference count. If the SafeHandle is collected or disposed while the raw value is still in use, the handle is closed underneath you and the value dangles.',
      sourceCode,
      'Use the SafeHandle directly, or bracket the access with DangerousAddRef/DangerousRelease so the handle cannot be reclaimed while in use.',
    )
  },
}
