import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { getCSharpReceiverSimpleName } from './_helpers.js'

/**
 * `Process.GetCurrentProcess().MainModule.FileName` creates a disposable
 * `Process` object and resolves its main module just to read the executable
 * path. `Environment.ProcessPath` returns the same value directly. Matches
 * the chain `Process.GetCurrentProcess().MainModule.FileName`.
 */
export const csharpUseEnvironmentProcessPathVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/use-environment-processpath',
  languages: ['csharp'],
  nodeTypes: ['member_access_expression'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('name')?.text !== 'FileName') return null

    const mainModule = node.childForFieldName('expression')
    if (mainModule?.type !== 'member_access_expression') return null
    if (mainModule.childForFieldName('name')?.text !== 'MainModule') return null

    const inner = mainModule.childForFieldName('expression')
    if (inner?.type !== 'invocation_expression') return null
    if (getCSharpMethodName(inner) !== 'GetCurrentProcess') return null
    if (getCSharpReceiverSimpleName(inner) !== 'Process') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Use Environment.ProcessPath',
      'Process.GetCurrentProcess().MainModule.FileName creates a disposable Process object and resolves its main module just to read the executable path. Environment.ProcessPath returns it directly.',
      sourceCode,
      'Replace Process.GetCurrentProcess().MainModule.FileName with Environment.ProcessPath.',
    )
  },
}
