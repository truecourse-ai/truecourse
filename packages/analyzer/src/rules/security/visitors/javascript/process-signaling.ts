import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * True when the PID expression reads `.process.pid` off some object — the
 * idiomatic Node way to reference a forked worker or spawned child process
 * (`worker.process.pid`, `cluster.workers[id].process.pid`). The parent
 * process owns these PIDs, so signalling them is not arbitrary-process
 * manipulation. A user-controlled PID (`req.query.pid`, `params.pid`) has a
 * different parent (`query`, `params`) and is not skipped.
 */
function isOwnedProcessPid(node: SyntaxNode): boolean {
  if (node.type !== 'member_expression') return false
  if (node.childForFieldName('property')?.text !== 'pid') return false
  const obj = node.childForFieldName('object')
  return obj?.type === 'member_expression' && obj.childForFieldName('property')?.text === 'process'
}

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

    // Skip PIDs read from a process/worker/child the program itself spawned:
    // `worker.process.pid`, `cluster.workers[id].process.pid`, etc. A
    // `.process.pid` access is the id of an owned child process — never
    // attacker-controlled — so forwarding a signal to it is safe. This is
    // distinct from a user-supplied PID like `req.query.pid`, whose parent
    // is not `process`.
    if (isOwnedProcessPid(pidArg)) return null

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
