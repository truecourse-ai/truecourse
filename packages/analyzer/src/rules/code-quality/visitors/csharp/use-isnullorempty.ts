import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A manual null-or-empty string test — `s == null || s == ""` or
 * `s == null || s.Length == 0` — restates `string.IsNullOrEmpty(s)`
 * (RCS1113). The check fires on a top-level `||` whose left operand is
 * `s == null` and whose right operand is an emptiness test (`s == ""`,
 * `s == string.Empty`, or `s.Length == 0`) over the *same* operand `s`.
 */
function nullCheckOperand(node: SyntaxNode | null): string | null {
  if (node?.type !== 'binary_expression' || node.childForFieldName('operator')?.text !== '==') return null
  const left = node.childForFieldName('left')
  const right = node.childForFieldName('right')
  if (left?.type === 'identifier' && right?.type === 'null_literal') return left.text
  if (right?.type === 'identifier' && left?.type === 'null_literal') return right.text
  return null
}

function isEmptyStringLiteral(n: SyntaxNode | null): boolean {
  if (n?.type === 'string_literal') {
    return !n.namedChildren.some((c) => c?.type === 'string_literal_content' || c?.type === 'escape_sequence')
  }
  if (n?.type === 'member_access_expression') {
    const recv = n.childForFieldName('expression')?.text
    return (recv === 'string' || recv === 'String') && n.childForFieldName('name')?.text === 'Empty'
  }
  return false
}

/** Emptiness test over `target`: `target == ""`, `target == string.Empty`, or `target.Length == 0`. */
function emptyCheckOperand(node: SyntaxNode | null): string | null {
  if (node?.type !== 'binary_expression' || node.childForFieldName('operator')?.text !== '==') return null
  const left = node.childForFieldName('left')
  const right = node.childForFieldName('right')
  if (!left || !right) return null

  // `target == ""`
  if (left.type === 'identifier' && isEmptyStringLiteral(right)) return left.text
  if (right.type === 'identifier' && isEmptyStringLiteral(left)) return right.text

  // `target.Length == 0`
  const lengthZero = (a: SyntaxNode, b: SyntaxNode): string | null => {
    if (a.type !== 'member_access_expression' || a.childForFieldName('name')?.text !== 'Length') return null
    if (b.type !== 'integer_literal' || b.text !== '0') return null
    const recv = a.childForFieldName('expression')
    return recv?.type === 'identifier' ? recv.text : null
  }
  return lengthZero(left, right) ?? lengthZero(right, left)
}

export const csharpUseIsNullOrEmptyVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/use-isnullorempty',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('operator')?.text !== '||') return null
    // Report once on the outermost `||`.
    if (node.parent?.type === 'binary_expression' && node.parent.childForFieldName('operator')?.text === '||') return null

    const nullTarget = nullCheckOperand(node.childForFieldName('left'))
    const emptyTarget = emptyCheckOperand(node.childForFieldName('right'))
    if (!nullTarget || !emptyTarget || nullTarget !== emptyTarget) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Use string.IsNullOrEmpty',
      `\`${nullTarget} == null || …\` restates \`string.IsNullOrEmpty(${nullTarget})\`.`,
      sourceCode,
      `Replace the manual check with \`string.IsNullOrEmpty(${nullTarget})\`.`,
    )
  },
}
