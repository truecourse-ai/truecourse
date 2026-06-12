import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_FUNCTION_BOUNDARIES, isScalarLiteral } from './_helpers.js'

function collectReturns(body: SyntaxNode): SyntaxNode[] {
  const returns: SyntaxNode[] = []
  const walk = (n: SyntaxNode): void => {
    if (n.type === 'return_statement') returns.push(n)
    for (const child of n.namedChildren) {
      if (!child || CSHARP_FUNCTION_BOUNDARIES.has(child.type)) continue
      walk(child)
    }
  }
  walk(body)
  return returns
}

/**
 * A method whose every return path yields the same literal — the branching
 * logic is pointless and one branch was probably meant to return something
 * else (classic copy-paste bug).
 *
 * Methods with `out`/`ref` parameters are skipped: their useful results
 * flow through the parameters, so an invariant return value is normal.
 */
export const csharpInvariantReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/invariant-return',
  languages: ['csharp'],
  nodeTypes: ['method_declaration', 'local_function_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body || body.type !== 'block') return null

    const params = node.childForFieldName('parameters')
    const hasOutOrRef = params?.namedChildren.some((p) =>
      p?.namedChildren.some((c) => c?.type === 'modifier' && (c.text === 'out' || c.text === 'ref')),
    )
    if (hasOutOrRef) return null

    const returns = collectReturns(body)
    if (returns.length < 2) return null

    const values: string[] = []
    for (const ret of returns) {
      const value = ret.namedChildren[0]
      if (!value || !isScalarLiteral(value)) return null
      if (value.type === 'interpolated_string_expression') return null
      values.push(value.text)
    }

    const first = values[0]!
    if (!values.every((v) => v === first)) return null

    const name = node.childForFieldName('name')?.text ?? 'method'
    return makeViolation(
      this.ruleKey, node.childForFieldName('name') ?? node, filePath, 'medium',
      'Invariant function return',
      `\`${name}\` returns \`${first}\` from every path regardless of its branching logic — one of the branches probably should return a different value.`,
      sourceCode,
      'Review the return statements and ensure each branch returns the intended value.',
    )
  },
}
