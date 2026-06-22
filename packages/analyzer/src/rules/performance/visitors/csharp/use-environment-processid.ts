import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { getCSharpReceiverSimpleName } from './_helpers.js'

/**
 * `Process.GetCurrentProcess().Id` creates a disposable `Process` object (a
 * native handle) just to read the current process id. `Environment.ProcessId`
 * returns the same value with no allocation or handle. Matches the
 * member-access `Process.GetCurrentProcess().Id`.
 */
export const csharpUseEnvironmentProcessIdVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/use-environment-processid',
  languages: ['csharp'],
  nodeTypes: ['member_access_expression'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('name')?.text !== 'Id') return null

    const inner = node.childForFieldName('expression')
    if (inner?.type !== 'invocation_expression') return null
    if (getCSharpMethodName(inner) !== 'GetCurrentProcess') return null
    if (getCSharpReceiverSimpleName(inner) !== 'Process') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Use Environment.ProcessId',
      'Process.GetCurrentProcess().Id creates a disposable Process object holding a native handle just to read the current process id. Environment.ProcessId returns the same value with no allocation.',
      sourceCode,
      'Replace Process.GetCurrentProcess().Id with Environment.ProcessId.',
    )
  },
}
