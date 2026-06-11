import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { assignmentTarget, isConditionallyGuarded } from './_helpers.js'

/**
 * SSH.NET host key handler trusting every key: an unconditional
 * `e.CanTrust = true` inside a HostKeyReceived handler. Conditional
 * assignments (fingerprint comparisons, known-hosts checks) are the correct
 * idiom and never match.
 */
export const csharpSshNoHostKeyVerificationVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/ssh-no-host-key-verification',
  languages: ['csharp'],
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    const target = assignmentTarget(node)
    if (!target || target.name !== 'CanTrust') return null
    if (target.value.type !== 'boolean_literal' || target.value.text !== 'true') return null
    if (isConditionallyGuarded(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'SSH without host key verification',
      'CanTrust = true accepts any SSH host key unconditionally, enabling man-in-the-middle attacks.',
      sourceCode,
      'Compare e.FingerPrint (or e.HostKey) against the known expected key before setting CanTrust.',
    )
  },
}
