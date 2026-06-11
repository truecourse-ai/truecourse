import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Constructing a decimal from a double/float LITERAL — `(decimal)0.1`,
 * `new decimal(0.1)`, `Convert.ToDecimal(0.1)` — bakes the binary
 * floating-point error into the decimal. The literal should carry the
 * `m` suffix instead (`0.1m`), which is exact.
 *
 * Casting a double VARIABLE to decimal is a deliberate (lossy) conversion
 * and is not flagged.
 */
function realLiteralIn(node: SyntaxNode | null): SyntaxNode | null {
  if (!node) return null
  if (node.type === 'real_literal' && !/[mM]$/.test(node.text)) return node
  // unary minus: -0.1
  if (node.type === 'prefix_unary_expression') {
    const inner = node.namedChildren[0]
    if (inner?.type === 'real_literal' && !/[mM]$/.test(inner.text)) return inner
  }
  return null
}

export const csharpDecimalFromFloatVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/decimal-from-float',
  languages: ['csharp'],
  nodeTypes: ['cast_expression', 'object_creation_expression', 'invocation_expression'],
  visit(node, filePath, sourceCode) {
    let literal: SyntaxNode | null = null

    if (node.type === 'cast_expression') {
      if (node.childForFieldName('type')?.text !== 'decimal') return null
      literal = realLiteralIn(node.childForFieldName('value'))
    } else if (node.type === 'object_creation_expression') {
      const type = node.childForFieldName('type')?.text
      if (type !== 'decimal' && type !== 'Decimal' && type !== 'System.Decimal') return null
      const firstArg = node.childForFieldName('arguments')?.namedChildren[0]?.namedChildren[0] ?? null
      literal = realLiteralIn(firstArg)
    } else {
      const fn = node.childForFieldName('function')
      if (fn?.type !== 'member_access_expression') return null
      if (fn.childForFieldName('name')?.text !== 'ToDecimal') return null
      const receiver = fn.childForFieldName('expression')?.text ?? ''
      if (receiver !== 'Convert' && !receiver.endsWith('.Convert')) return null
      const firstArg = node.childForFieldName('arguments')?.namedChildren[0]?.namedChildren[0] ?? null
      literal = realLiteralIn(firstArg)
    }

    if (!literal) return null

    const digits = literal.text.replace(/[fFdD]$/, '')
    return makeViolation(
      this.ruleKey, literal, filePath, 'high',
      'Decimal constructed from float literal',
      `\`${literal.text}\` is a binary floating-point literal — converting it to decimal bakes in the representation error (e.g. 0.1 is not exactly representable as a double). Use a decimal literal instead.`,
      sourceCode,
      `Replace with the decimal literal \`${digits}m\`.`,
    )
  },
}
