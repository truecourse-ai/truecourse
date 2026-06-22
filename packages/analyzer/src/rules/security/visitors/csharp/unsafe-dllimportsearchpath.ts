import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpAttributes } from './_helpers.js'

/**
 * `[DefaultDllImportSearchPaths(...)]` configured with a value that includes
 * attacker-writable directories — `AssemblyDirectory`,
 * `UseDllDirectoryForDependencies`, `ApplicationDirectory`, or `LegacyBehavior`.
 * These keep the native-library search open to DLL hijacking that the attribute
 * is supposed to close.
 */
const UNSAFE_VALUES = /\b(?:AssemblyDirectory|UseDllDirectoryForDependencies|ApplicationDirectory|LegacyBehavior)\b/

export const csharpUnsafeDllImportSearchPathVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unsafe-dllimportsearchpath',
  languages: ['csharp'],
  nodeTypes: ['method_declaration', 'class_declaration', 'struct_declaration'],
  visit(node, filePath, sourceCode) {
    const attr = getCSharpAttributes(node).find((a) => a.name === 'DefaultDllImportSearchPaths')
    if (!attr) return null
    const value = attr.args[0]?.value
    if (!value || !UNSAFE_VALUES.test(value.text)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Unsafe DllImportSearchPath value',
      'This DefaultDllImportSearchPaths value keeps an attacker-writable directory in the native-library search order, allowing DLL hijacking.',
      sourceCode,
      'Use a safe search path such as DllImportSearchPath.System32 (optionally combined with SafeDirectories).',
    )
  },
}
