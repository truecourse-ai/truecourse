import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName } from '../../../_shared/csharp-helpers.js'

/**
 * `xs.Where(p).ToList().Any()` materializes the whole filtered sequence
 * before a short-circuiting Any()/All() — the C# shape of "list comprehension
 * inside any()/all()". Dropping the ToList()/ToArray() lets Any/All stop at
 * the first match.
 */
export const csharpListCompInAnyAllVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/list-comprehension-in-any-all',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const method = getCSharpMethodName(node)
    if (method !== 'Any' && method !== 'All') return null

    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression') return null
    const inner = fn.childForFieldName('expression')
    if (inner?.type !== 'invocation_expression') return null
    const innerMethod = getCSharpMethodName(inner)
    if (innerMethod !== 'ToList' && innerMethod !== 'ToArray') return null
    if (getCSharpArguments(inner).length !== 0) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      `${innerMethod}() before ${method}() defeats short-circuiting`,
      `${innerMethod}() materializes the entire sequence before ${method}() runs, but ${method}() short-circuits on the first match. Drop the ${innerMethod}().`,
      sourceCode,
      `Remove the ${innerMethod}() call and invoke ${method}() directly on the sequence.`,
    )
  },
}
