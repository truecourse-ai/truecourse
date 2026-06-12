import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { getCSharpLoopBodyStatements } from './_helpers.js'

/**
 * A foreach whose entire body is `collection.Add(item)` with the bare loop
 * variable: `foreach (var id in ids) seen.Add(id);` — HashSet.UnionWith()
 * or List.AddRange() does it in one call. Only the untransformed-element
 * shape is flagged; `xs.Add(x.Id)` would need a Select and is left alone.
 */
export const csharpSetMutationsInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/set-mutations-in-loop',
  languages: ['csharp'],
  nodeTypes: ['foreach_statement'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    if (!left || left.type !== 'identifier') return null
    const loopVar = left.text

    const statements = getCSharpLoopBodyStatements(node)
    if (statements.length !== 1) return null
    const stmt = statements[0]!
    const expr = stmt.type === 'expression_statement' ? stmt.namedChildren[0] : stmt
    if (!expr || expr.type !== 'invocation_expression') return null

    if (getCSharpMethodName(expr) !== 'Add') return null
    const receiver = getCSharpReceiver(expr)
    if (!receiver) return null

    const args = getCSharpArguments(expr)
    if (args.length !== 1) return null
    if (args[0]!.type !== 'identifier' || args[0]!.text !== loopVar) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Element-by-element .Add() in foreach',
      `The loop only calls ${receiver}.Add(${loopVar}). A bulk operation copies the whole sequence in one call.`,
      sourceCode,
      `Replace the loop with ${receiver}.UnionWith(...) for a HashSet or ${receiver}.AddRange(...) for a List.`,
    )
  },
}
