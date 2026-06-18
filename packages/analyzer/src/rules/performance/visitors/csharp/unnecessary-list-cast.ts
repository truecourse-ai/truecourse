import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName } from '../../../_shared/csharp-helpers.js'

/**
 * `xs.Select(...).ToList().ToArray()` (any ToList/ToArray pair chained
 * back-to-back) materializes the sequence twice; one call suffices — the C#
 * shape of `list([...])` around an already-materialized list.
 */
const MATERIALIZERS = new Set(['ToList', 'ToArray'])

export const csharpUnnecessaryListCastVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/unnecessary-list-cast',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const method = getCSharpMethodName(node)
    if (!MATERIALIZERS.has(method)) return null
    if (getCSharpArguments(node).length !== 0) return null

    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression') return null
    const inner = fn.childForFieldName('expression')
    if (inner?.type !== 'invocation_expression') return null
    const innerMethod = getCSharpMethodName(inner)
    if (!MATERIALIZERS.has(innerMethod)) return null
    if (getCSharpArguments(inner).length !== 0) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `Redundant ${innerMethod}().${method}()`,
      `${innerMethod}().${method}() copies the sequence twice. A single ${method}() call materializes it once.`,
      sourceCode,
      `Remove the ${innerMethod}() call and keep only ${method}().`,
    )
  },
}
