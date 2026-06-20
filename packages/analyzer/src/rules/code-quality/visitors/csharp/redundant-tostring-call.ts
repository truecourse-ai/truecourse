import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** True when `node` is a `recv.ToString()` call with no arguments. */
function isParameterlessToString(node: SyntaxNode): boolean {
  if (node.type !== 'invocation_expression') return false
  const fn = node.childForFieldName('function')
  if (fn?.type !== 'member_access_expression') return false
  if (fn.childForFieldName('name')?.text !== 'ToString') return false
  // A formatted ToString("X") / ToString(provider) is not redundant.
  const args = node.childForFieldName('arguments')
  return !args || args.namedChildCount === 0
}

/** A string literal / interpolated string — already in string form. */
function isStringLiteralOperand(node: SyntaxNode): boolean {
  return (
    node.type === 'string_literal' ||
    node.type === 'verbatim_string_literal' ||
    node.type === 'raw_string_literal' ||
    node.type === 'interpolated_string_expression'
  )
}

/**
 * Calling `.ToString()` on a value already in a string context — string
 * concatenation where one side is a string literal, or inside a `$"…"`
 * interpolation hole — is redundant work the compiler already does (S1858).
 * The interpolation case is unconditional (the hole always stringifies); the
 * concatenation case requires the sibling operand to be a string literal so
 * we never misjudge a numeric `+`.
 */
export const csharpRedundantToStringCallVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-tostring-call',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (!isParameterlessToString(node)) return null

    const parent = node.parent
    if (!parent) return null

    // Inside a `$"{ … }"` interpolation hole the value is always stringified.
    if (parent.type === 'interpolation') {
      return report(this.ruleKey, node, filePath, sourceCode, 'an interpolation hole')
    }

    // `"x" + value.ToString()` / `value.ToString() + "x"` — string concat.
    if (parent.type === 'binary_expression' && parent.childForFieldName('operator')?.text === '+') {
      const left = parent.childForFieldName('left')
      const right = parent.childForFieldName('right')
      const other = left?.id === node.id ? right : left
      if (other && isStringLiteralOperand(other)) {
        return report(this.ruleKey, node, filePath, sourceCode, 'a string concatenation')
      }
    }

    return null
  },
}

function report(ruleKey: string, node: SyntaxNode, filePath: string, sourceCode: string, where: string) {
  return makeViolation(
    ruleKey, node, filePath, 'low',
    'Redundant ToString() call',
    `\`.ToString()\` is called on a value already in ${where}, where it is converted to a string anyway — the call is redundant (S1858).`,
    sourceCode,
    'Remove the redundant `.ToString()` call.',
  )
}
