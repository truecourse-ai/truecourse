import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { assignmentTarget, getCallArgs, isPlainStringLiteral, lastSegment, staticStringText } from './_helpers.js'

/**
 * Launching an external executable by a bare Windows executable name —
 * `Process.Start("regsvr32.exe")` or `ProcessStartInfo.FileName = "tool.exe"` —
 * where the literal carries an executable extension (.exe/.bat/.cmd/.com) but
 * no directory component. The name then resolves through PATH and the current
 * directory, so an attacker who plants a same-named binary earlier in the
 * search order runs instead of the intended program.
 *
 * Scoped to literals with an explicit executable extension to stay precise:
 * dynamic command building is covered by os-command-injection.
 */
const BARE_EXECUTABLE = /^[^\\/:%]+\.(?:exe|bat|cmd|com)$/i

function isBareExecutableLiteral(node: SyntaxNode | undefined): boolean {
  if (!node || !isPlainStringLiteral(node)) return false
  return BARE_EXECUTABLE.test(staticStringText(node).trim())
}

export const csharpCommandResolvedFromPathVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/command-resolved-from-path',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression', 'assignment_expression'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'assignment_expression') {
      const target = assignmentTarget(node)
      if (!target || target.name !== 'FileName') return null
      if (!isBareExecutableLiteral(target.value)) return null
    } else {
      if (getCSharpMethodName(node) !== 'Start') return null
      if (lastSegment(getCSharpReceiver(node)) !== 'Process') return null
      if (!isBareExecutableLiteral(getCallArgs(node)[0]?.value)) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'OS command resolved from PATH',
      'Launching an executable by bare name resolves it through PATH and the working directory, so an attacker-planted binary earlier in the search order can run instead.',
      sourceCode,
      'Pass the full, absolute path to the executable.',
    )
  },
}
