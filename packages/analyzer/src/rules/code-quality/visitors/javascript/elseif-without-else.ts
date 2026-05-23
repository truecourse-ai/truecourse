import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

const LITERAL_NODE_TYPES = new Set([
  'string', 'number', 'null', 'undefined', 'true', 'false',
])

/**
 * Identify the variable being narrowed by `condition`, if the condition has
 * one of the shapes used in discriminated-union narrowing. Returns the
 * identifier text, or `null` if the condition doesn't match those shapes.
 *
 * Shapes recognised:
 *   - `foo`                       (truthy check on a single identifier)
 *   - `foo === <literal>`         (equality narrowing — strict & loose)
 *   - `typeof foo === '<literal>'`(typeof narrowing)
 */
function narrowedIdentifier(condition: SyntaxNode | null): string | null {
  if (!condition) return null
  while (condition?.type === 'parenthesized_expression') {
    condition = condition.namedChildren[0] ?? null
  }
  if (!condition) return null
  if (condition.type === 'identifier') return condition.text
  if (condition.type !== 'binary_expression') return null
  const op = condition.childForFieldName('operator')?.text
  if (op !== '===' && op !== '!==' && op !== '==' && op !== '!=') return null
  const left = condition.childForFieldName('left')
  const right = condition.childForFieldName('right')
  if (!left || !right) return null
  const leftLit = LITERAL_NODE_TYPES.has(left.type)
  const rightLit = LITERAL_NODE_TYPES.has(right.type)
  if (leftLit === rightLit) return null
  const operand = leftLit ? right : left
  if (operand.type === 'identifier') return operand.text
  if (operand.type === 'unary_expression' && operand.firstChild?.text === 'typeof') {
    const inner = operand.namedChildren[0]
    if (inner?.type === 'identifier') return inner.text
  }
  return null
}

export const elseifWithoutElseVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/elseif-without-else',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const parent = node.parent
    if (parent?.type === 'else_clause') return null

    // Skip files in /components/ui/ directories (third-party generated components like shadcn/ui)
    if (/\/components\/ui\//.test(filePath)) return null

    let hasElseIf = false
    let hasElse = false
    const narrowedIds: Array<string | null> = []

    let currentNode: SyntaxNode | null = node
    while (currentNode?.type === 'if_statement') {
      narrowedIds.push(narrowedIdentifier(currentNode.childForFieldName('condition')))
      const elseClause: import('web-tree-sitter').Node | undefined = currentNode.children.find((c) => c.type === 'else_clause')
      if (!elseClause) break

      const elseBody: import('web-tree-sitter').Node | undefined = elseClause.namedChildren[0]
      if (!elseBody) break

      if (elseBody.type === 'if_statement') {
        hasElseIf = true
        currentNode = elseBody
      } else {
        hasElse = true
        break
      }
    }

    if (hasElseIf && !hasElse) {
      // Skip the discriminated-union narrowing idiom: every branch tests a
      // different literal value (or typeof tag) of the same identifier. The
      // missing `else` here is "unreachable on a closed union" — adding one
      // is dead code, not a defensive guard.
      const first = narrowedIds[0]
      if (first !== null && narrowedIds.every((id) => id !== null && id === first)) return null

      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'else-if chain without final else',
        '`if...else if` chain has no final `else` clause — unhandled cases may be silently ignored.',
        sourceCode,
        'Add a final `else` clause to handle unexpected cases, or document why it is intentionally omitted.',
      )
    }
    return null
  },
}
