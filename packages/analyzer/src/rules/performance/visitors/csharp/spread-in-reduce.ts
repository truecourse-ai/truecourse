import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName, walkCSharp } from '../../../_shared/csharp-helpers.js'
import { getCSharpChainRoot } from './_helpers.js'

/**
 * C# port of "spread in reduce": an Aggregate() callback that copies the
 * accumulator every iteration — `acc.Concat(...)`, `acc.Append(...)`, or
 * `new List<T>(acc) { ... }` — building an O(n^2) fold. Mutating folds
 * (`acc.Add(x); return acc;`) and scalar folds (`acc + x`) are fine.
 */
const COPYING_METHODS = new Set(['Concat', 'Union', 'Append', 'Prepend'])

function lambdaParamNames(lambda: SyntaxNode): string[] {
  const params = lambda.childForFieldName('parameters')
  if (!params) return []
  if (params.type === 'implicit_parameter') return [params.text]
  return params.namedChildren
    .filter((c) => c?.type === 'parameter')
    .map((c) => c!.childForFieldName('name')?.text ?? '')
    .filter(Boolean)
}

export const csharpSpreadInReduceVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/spread-in-reduce',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpMethodName(node) !== 'Aggregate') return null

    const lambda = getCSharpArguments(node).find(
      (arg) => arg.type === 'lambda_expression' && lambdaParamNames(arg).length === 2,
    )
    if (!lambda) return null
    const accumulator = lambdaParamNames(lambda)[0]!

    const body = lambda.childForFieldName('body')
    if (!body) return null

    let copies: string | null = null
    walkCSharp(body, (n: SyntaxNode) => {
      if (copies) return
      if (n.type === 'invocation_expression') {
        const method = getCSharpMethodName(n)
        if (COPYING_METHODS.has(method)) {
          const root = getCSharpChainRoot(n)
          if (root.type === 'identifier' && root.text === accumulator) copies = `${accumulator}.${method}()`
        }
        return
      }
      // new List<T>(acc) — copy-constructing the accumulator
      if (n.type === 'object_creation_expression') {
        const copiesAcc = getCSharpArguments(n).some(
          (arg) => arg.type === 'identifier' && arg.text === accumulator,
        )
        if (copiesAcc) copies = `new ...(${accumulator})`
      }
    })
    if (!copies) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Accumulator copied inside Aggregate()',
      `The Aggregate() callback rebuilds the accumulator (${copies}) on every iteration, making the fold O(n^2).`,
      sourceCode,
      'Mutate one collection instead: use a foreach with List.Add()/HashSet.UnionWith(), or SelectMany() for flattening.',
    )
  },
}
