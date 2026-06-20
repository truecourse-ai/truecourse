import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `Thread.CurrentThread.ManagedThreadId` allocates/looks up the current
 * `Thread` object just to read its id. `Environment.CurrentManagedThreadId`
 * reads the same value directly with no `Thread` access. Matches the
 * member-access chain `...CurrentThread.ManagedThreadId`.
 */
export const csharpUseCurrentManagedThreadIdVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/use-currentmanagedthreadid',
  languages: ['csharp'],
  nodeTypes: ['member_access_expression'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('name')?.text !== 'ManagedThreadId') return null

    const receiver = node.childForFieldName('expression')
    if (receiver?.type !== 'member_access_expression') return null
    if (receiver.childForFieldName('name')?.text !== 'CurrentThread') return null

    // The CurrentThread receiver must be the Thread static type — a
    // `CurrentThread` member on some unrelated object is not flagged.
    const threadType = receiver.childForFieldName('expression')
    if (!threadType) return null
    const threadSimpleName =
      threadType.type === 'member_access_expression'
        ? threadType.childForFieldName('name')?.text
        : threadType.type === 'qualified_name'
          ? threadType.childForFieldName('name')?.text
          : threadType.text
    if (threadSimpleName !== 'Thread') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Use Environment.CurrentManagedThreadId',
      'Thread.CurrentThread.ManagedThreadId resolves the current Thread object only to read its id. Environment.CurrentManagedThreadId reads the same value directly.',
      sourceCode,
      'Replace Thread.CurrentThread.ManagedThreadId with Environment.CurrentManagedThreadId.',
    )
  },
}
