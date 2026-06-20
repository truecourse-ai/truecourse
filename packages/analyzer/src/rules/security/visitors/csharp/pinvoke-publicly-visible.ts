import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpAttributeNames, hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

/**
 * A `[DllImport]` (P/Invoke) method declared `public`. Exposing an
 * unmanaged-code entry point across the assembly boundary lets any caller
 * invoke native code directly, with no managed validation layer. P/Invoke
 * declarations should be `private` or `internal`.
 */
export const csharpPInvokePubliclyVisibleVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/pinvoke-publicly-visible',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    if (!hasCSharpModifier(node, 'public')) return null
    const attrs = getCSharpAttributeNames(node)
    if (!attrs.includes('DllImport')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'P/Invoke method is publicly visible',
      'A public [DllImport] method exposes an unmanaged-code entry point across the assembly boundary with no managed validation layer.',
      sourceCode,
      'Make the P/Invoke declaration private or internal and wrap it in a validated public method.',
    )
  },
}
