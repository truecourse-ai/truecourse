import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'
import { getCSharpDeclAttributeNames } from './_helpers.js'

/**
 * A `public` P/Invoke declaration (`extern` + `[DllImport]`) exposes a raw,
 * unmanaged native call directly to callers, instead of hiding it behind a
 * managed wrapper that validates inputs and translates error codes. The check
 * fires on a `public` `method_declaration` carrying both the `extern` modifier
 * and a `[DllImport]` attribute. Non-public natives are an implementation
 * detail and are left alone.
 */
export const csharpNativeMethodNotWrappedVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/native-method-not-wrapped',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    if (!hasCSharpModifier(node, 'extern')) return null
    if (!hasCSharpModifier(node, 'public')) return null
    if (!getCSharpDeclAttributeNames(node).includes('DllImport')) return null

    const name = node.childForFieldName('name')?.text ?? 'method'
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Unwrapped native method',
      `Public P/Invoke method \`${name}\` exposes an unsafe native call directly instead of behind a managed wrapper.`,
      sourceCode,
      'Make the P/Invoke declaration `private`/`internal` and expose a validated managed wrapper.',
    )
  },
}
