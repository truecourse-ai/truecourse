import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpAttributes } from './_helpers.js'

/**
 * A `[DllImport]` P/Invoke method that does not also carry
 * `[DefaultDllImportSearchPaths]`. Without an explicit search-path constraint
 * the loader probes the application directory and the current working
 * directory, so a native library planted alongside the app can be hijacked.
 * The attribute can sit on the method or on the assembly; this rule checks the
 * method, where the per-import fix lives.
 */
export const csharpPInvokeNoDllImportSearchPathVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/pinvoke-no-dllimportsearchpath',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    const attrs = getCSharpAttributes(node)
    if (!attrs.some((a) => a.name === 'DllImport')) return null
    if (attrs.some((a) => a.name === 'DefaultDllImportSearchPaths')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'P/Invoke without DefaultDllImportSearchPaths',
      'A [DllImport] without a search-path constraint lets the loader probe the application and working directories, opening the door to DLL hijacking.',
      sourceCode,
      'Add [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] (or another safe value) to constrain the native library search.',
    )
  },
}
