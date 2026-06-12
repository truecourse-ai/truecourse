import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `source.Aggregate(func)` — the seedless overload throws
 * InvalidOperationException ("Sequence contains no elements") when the
 * source is empty. `Aggregate(seed, func)` is safe.
 */
export const csharpReduceMissingInitialVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/reduce-missing-initial',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression') return null
    if (fn.childForFieldName('name')?.text !== 'Aggregate') return null

    const args = node.childForFieldName('arguments')?.namedChildren ?? []
    if (args.length !== 1) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Aggregate without a seed',
      '`Aggregate(func)` without a seed throws InvalidOperationException when the sequence is empty.',
      sourceCode,
      'Pass a seed as the first argument: `.Aggregate(seed, func)` — or guard the call with a non-empty check.',
    )
  },
}
