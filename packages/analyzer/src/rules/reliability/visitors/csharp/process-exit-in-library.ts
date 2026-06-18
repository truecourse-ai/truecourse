import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { isCSharpEntryPointFile, simpleTypeName } from './_helpers.js'

/**
 * `Environment.Exit()` outside entry-point code. Entry points are detected
 * structurally (top-level statements or a `static Main` in the file) and by
 * convention (Program.cs / Main.cs, scripts/, tools/).
 *
 * `Environment.FailFast()` is intentionally NOT flagged — it exists precisely
 * for unrecoverable-state aborts and calling it is a deliberate decision.
 */
export const csharpProcessExitInLibraryVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/process-exit-in-library',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpMethodName(node) !== 'Exit') return null
    if (simpleTypeName(getCSharpReceiver(node)) !== 'Environment') return null

    if (isCSharpEntryPointFile(node, filePath)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Environment.Exit() in non-entry-point code',
      'Environment.Exit() terminates the entire process, skipping finally blocks and disposals in callers. Library code should throw instead.',
      sourceCode,
      'Throw an exception (or return a failure result) and let the entry point decide whether to exit the process.',
    )
  },
}
