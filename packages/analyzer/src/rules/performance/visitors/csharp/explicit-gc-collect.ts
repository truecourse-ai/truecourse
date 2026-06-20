import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'

/**
 * `GC.Collect()` forces a costly full garbage collection and almost always
 * hurts throughput: it pre-empts the runtime's adaptive collection schedule
 * and promotes survivors. The receiver must be the `GC` static type — a
 * `Collect` method on some other object is not flagged.
 */
export const csharpExplicitGcCollectVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/explicit-gc-collect',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpMethodName(node) !== 'Collect') return null
    if (getCSharpReceiver(node) !== 'GC') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'GC.Collect should not be called',
      'GC.Collect() forces a full, blocking garbage collection that pre-empts the runtime’s adaptive schedule and promotes survivors to older generations, usually hurting throughput rather than helping.',
      sourceCode,
      'Remove the GC.Collect() call and let the runtime manage collections.',
    )
  },
}
