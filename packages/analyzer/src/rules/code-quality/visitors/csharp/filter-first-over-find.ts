import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'

/** LINQ terminals that take a predicate overload, so `.Where(p).X()` folds into `.X(p)`. */
const FOLDABLE_TERMINALS = new Set([
  'First', 'FirstOrDefault', 'Single', 'SingleOrDefault',
  'Last', 'LastOrDefault', 'Any', 'Count',
])

/** Number of parameters a lambda argument declares (predicates have 1; `(x, i)` overloads have 2). */
function lambdaParamCount(expr: SyntaxNode): number {
  if (expr.type !== 'lambda_expression') return 1
  const paramList = expr.namedChildren.find((c) => c?.type === 'parameter_list')
  if (!paramList) return 1 // implicit single parameter
  return paramList.namedChildren.filter((c) => c?.type === 'parameter').length
}

/**
 * `.Where(pred).First()` — the predicate belongs on the terminal:
 * `.First(pred)` is the same query without the intermediate iterator.
 * The C# analog of `.filter(fn)[0]` → `.find(fn)`.
 */
export const csharpFilterFirstOverFindVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/filter-first-over-find',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const terminal = getCSharpMethodName(node)
    if (!FOLDABLE_TERMINALS.has(terminal)) return null
    // The terminal must be argument-less — `.First(otherPred)` can't absorb the Where.
    if ((node.childForFieldName('arguments')?.namedChildCount ?? 0) !== 0) return null

    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression') return null
    const receiver = fn.childForFieldName('expression')
    if (receiver?.type !== 'invocation_expression') return null
    if (getCSharpMethodName(receiver) !== 'Where') return null

    const whereArgs = receiver.childForFieldName('arguments')?.namedChildren ?? []
    if (whereArgs.length !== 1) return null
    const predicate = whereArgs[0]?.namedChildren[0]
    if (!predicate) return null
    // `Where((x, i) => …)` uses the index overload — terminals have no such overload.
    if (lambdaParamCount(predicate) !== 1) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `Where().${terminal}() instead of ${terminal}(predicate)`,
      `\`.Where(pred).${terminal}()\` filters through an intermediate iterator just to apply the terminal. \`.${terminal}(pred)\` expresses the same query directly.`,
      sourceCode,
      `Replace \`.Where(pred).${terminal}()\` with \`.${terminal}(pred)\`.`,
    )
  },
}
