import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpAttributes } from './_helpers.js'

/**
 * A method annotated `[HandleProcessCorruptedStateExceptions]`. The attribute
 * re-enables catching exceptions that signal a corrupted process state
 * (AccessViolationException and friends), letting a handler swallow memory
 * corruption and keep running in a compromised process — an attacker can use
 * that to continue execution after a corruption they triggered.
 */
export const csharpCatchCorruptedStateExceptionVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/catch-corrupted-state-exception',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    const attrs = getCSharpAttributes(node)
    if (!attrs.some((a) => a.name === 'HandleProcessCorruptedStateExceptions')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Handling corrupted-state exceptions',
      'HandleProcessCorruptedStateExceptions lets a catch handler swallow exceptions that signal memory corruption, allowing code to keep running in a compromised process.',
      sourceCode,
      'Remove the attribute and let corrupted-state exceptions terminate the process; recover only by restarting in a clean process.',
    )
  },
}
