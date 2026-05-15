import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isInsideTryCatch } from './_helpers.js'

/**
 * Unwrap a node to its underlying expression by stripping parens and TS-only
 * wrappers (`as X`, `<X>e`, `e!`, `satisfies X`). Used to see through the
 * common deep-clone idiom written as `JSON.parse(JSON.stringify(x) as string)`.
 */
function unwrap(node: SyntaxNode | null): SyntaxNode | null {
  let cur: SyntaxNode | null = node
  while (cur) {
    if (cur.type === 'parenthesized_expression') {
      const inner = cur.namedChildren.find((c): c is SyntaxNode => !!c && c.type !== 'comment')
      if (!inner) return cur
      cur = inner
      continue
    }
    if (cur.type === 'as_expression' || cur.type === 'satisfies_expression') {
      const lhs = cur.namedChildren[0]
      if (!lhs) return cur
      cur = lhs
      continue
    }
    if (cur.type === 'type_assertion') {
      // <Type>expr — expression is the last named child
      const last = cur.namedChildren[cur.namedChildren.length - 1]
      if (!last) return cur
      cur = last
      continue
    }
    if (cur.type === 'non_null_expression') {
      const inner = cur.namedChildren[0]
      if (!inner) return cur
      cur = inner
      continue
    }
    return cur
  }
  return cur
}

/** True if `node` is a call expression of the form `JSON.stringify(...)`. */
function isJsonStringifyCall(node: SyntaxNode | null): boolean {
  const target = unwrap(node)
  if (!target || target.type !== 'call_expression') return false
  const fn = target.childForFieldName('function')
  if (!fn || fn.type !== 'member_expression') return false
  const obj = fn.childForFieldName('object')
  const prop = fn.childForFieldName('property')
  return obj?.text === 'JSON' && prop?.text === 'stringify'
}

export const unsafeJsonParseVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/unsafe-json-parse',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    if (fn.type !== 'member_expression') return null
    const obj = fn.childForFieldName('object')
    const prop = fn.childForFieldName('property')
    if (obj?.text !== 'JSON' || prop?.text !== 'parse') return null

    if (isInsideTryCatch(node)) return null

    // Deep-clone idiom: JSON.parse(JSON.stringify(x)). The argument is the
    // output of JSON.stringify(), which by spec is always valid JSON, so
    // JSON.parse() on it cannot throw. Skip to avoid a false positive.
    const args = node.childForFieldName('arguments')
    if (args) {
      const firstArg = args.namedChildren.find((c): c is SyntaxNode => !!c && c.type !== 'comment')
      if (firstArg && isJsonStringifyCall(firstArg)) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Unsafe JSON.parse',
      'JSON.parse() can throw on malformed input. Wrap it in a try/catch.',
      sourceCode,
      'Wrap JSON.parse() in a try/catch to handle malformed JSON gracefully.',
    )
  },
}
