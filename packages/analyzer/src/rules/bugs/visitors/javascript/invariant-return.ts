import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { DataFlowContext } from '../../../../data-flow/index.js'
import { JS_LANGUAGES } from './_helpers.js'

/**
 * Detects functions that always return the same literal value regardless
 * of any branching logic — likely a copy-paste bug.
 */

function getLiteralText(node: SyntaxNode): string | null {
  if (!node) return null
  const t = node.type
  if (t === 'string' || t === 'number' || t === 'true' || t === 'false' || t === 'null') return node.text
  if (t === 'identifier' && (node.text === 'undefined' || node.text === 'null')) return node.text
  return null
}

export const invariantReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/invariant-return',
  languages: JS_LANGUAGES,
  nodeTypes: ['function_declaration', 'function_expression', 'arrow_function', 'method_definition'],
  needsDataFlow: true,
  visit(node, filePath, sourceCode, dataFlow?: DataFlowContext) {
    if (!dataFlow) return null

    // Skip async functions — void async functions intentionally return undefined from every path
    if (node.children.some((c) => c.type === 'async')) return null

    // Skip arrow functions used as callbacks (event handlers, useEffect, etc.)
    if (node.type === 'arrow_function' && node.parent?.type === 'arguments') return null

    const scope = dataFlow.getScopeForNode(node)
    if (!scope) return null

    const returns = dataFlow.returnStatements(scope)

    // Need at least 2 return statements (single return is fine)
    if (returns.length < 2) return null

    // Collect the literal texts of all return values
    const values: string[] = []
    for (const ret of returns) {
      // return_statement: children[0] = 'return', children[1] = value
      const value = ret.namedChildren[0]
      if (!value) {
        // bare return — returns undefined implicitly, treat as 'undefined'
        values.push('undefined')
        continue
      }
      const lit = getLiteralText(value)
      if (lit === null) return null // non-literal return — can't determine invariance
      values.push(lit)
    }

    if (values.length < 2) return null

    // All values must be the same
    const first = values[0]
    if (!values.every((v) => v === first)) return null

    // Skip void functions (all bare returns) — early exits in void functions are standard
    if (first === 'undefined' && returns.every((r) => r.namedChildren.length === 0)) return null

    // Get function name for the message
    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text ?? 'function'

    return makeViolation(
      this.ruleKey,
      node,
      filePath,
      'medium',
      'Invariant function return',
      `\`${name}\` always returns \`${first}\` regardless of logic — this is likely a bug.`,
      sourceCode,
      'Review the return statements and ensure each branch returns the intended value.',
    )
  },
}
