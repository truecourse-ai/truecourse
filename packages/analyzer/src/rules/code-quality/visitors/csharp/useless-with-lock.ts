import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `lock (new object())` — every thread locks its own fresh object, so the
 * lock excludes nobody. The C# analog of `with threading.Lock():`.
 */
export const csharpUselessWithLockVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-with-lock',
  languages: ['csharp'],
  nodeTypes: ['lock_statement'],
  visit(node, filePath, sourceCode) {
    const lockTarget = node.namedChildren.find((c) => c && c.type !== 'block' && c.type !== 'comment')
    if (lockTarget?.type !== 'object_creation_expression') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Locking a fresh object',
      `\`lock (${lockTarget.text})\` creates a new object per entry — no two threads ever contend on it, so the critical section is unprotected.`,
      sourceCode,
      'Lock a shared instance instead: `private readonly object _sync = new(); … lock (_sync) { … }`.',
    )
  },
}
