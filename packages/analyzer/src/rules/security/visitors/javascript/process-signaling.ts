import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const processSignalingVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/process-signaling',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    if (fn.type !== 'member_expression') return null
    const obj = fn.childForFieldName('object')
    const prop = fn.childForFieldName('property')
    if (!obj || !prop) return null

    if (obj.text !== 'process' || prop.text !== 'kill') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const pidArg = args.namedChildren[0]
    if (!pidArg) return null

    // Flag when the PID argument is not a literal — it may be user-controlled
    if (pidArg.type !== 'number') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Sending signals to arbitrary processes',
        'process.kill() called with a non-literal PID. If the PID is user-controlled, this enables process manipulation.',
        sourceCode,
        'Validate and sanitize the PID before passing it to process.kill().',
      )
    }

    return null
  },
}
