import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects calling values that are obviously non-callable based on
 * AST heuristics. Without a full type checker we catch:
 *
 * 1. Calling a literal directly: `42()`, `"hello"()`, `True()`
 * 2. Calling a variable assigned a literal on the previous line(s)
 *    in the same scope (simple single-assignment tracking).
 *
 * Example:
 *   x = 42
 *   x()  # TypeError — int is not callable
 */
export const pythonNonCallableCalledVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/non-callable-called',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const func = node.childForFieldName('function')
    if (!func) return null

    // Case 1: Calling a literal directly — `42()`, `"foo"()`, `True()`
    if (isNonCallableLiteral(func)) {
      return makeViolation(
        this.ruleKey,
        node,
        filePath,
        'critical',
        'Calling a non-callable value',
        `\`${func.text}\` is not callable — this will raise a \`TypeError\` at runtime.`,
        sourceCode,
        'Remove the call or use the correct callable.',
      )
    }

    // Case 2: Simple identifier that was assigned a literal nearby
    if (func.type === 'identifier') {
      const assignedLiteral = findRecentLiteralAssignment(func)
      if (assignedLiteral) {
        return makeViolation(
          this.ruleKey,
          node,
          filePath,
          'critical',
          'Calling a non-callable value',
          `\`${func.text}\` was assigned a ${assignedLiteral} value and is not callable — \`TypeError\` at runtime.`,
          sourceCode,
          'Assign a callable value or remove the call.',
        )
      }
    }

    return null
  },
}

function isNonCallableLiteral(node: SyntaxNode): boolean {
  return (
    node.type === 'integer' ||
    node.type === 'float' ||
    node.type === 'string' ||
    node.type === 'concatenated_string' ||
    node.type === 'true' ||
    node.type === 'false' ||
    node.type === 'none'
  )
}

/**
 * Look backwards through siblings in the same block for a simple
 * `name = <literal>` assignment. Returns the literal type name or null.
 */
function findRecentLiteralAssignment(identNode: SyntaxNode): string | null {
  const name = identNode.text
  const callStmt = identNode.parent?.parent // call → expression_statement
  if (!callStmt) return null

  const block = callStmt.parent
  if (!block) return null

  // Walk backwards through siblings
  let sibling = callStmt.previousNamedSibling
  let lookback = 0
  const MAX_LOOKBACK = 10

  while (sibling && lookback < MAX_LOOKBACK) {
    // Look for `expression_statement > assignment` where left == name
    if (sibling.type === 'expression_statement') {
      const expr = sibling.namedChildren[0]
      if (expr?.type === 'assignment') {
        const left = expr.childForFieldName('left')
        const right = expr.childForFieldName('right')
        if (left?.text === name && right) {
          if (right.type === 'integer') return 'integer'
          if (right.type === 'float') return 'float'
          if (right.type === 'string' || right.type === 'concatenated_string') return 'string'
          if (right.type === 'true' || right.type === 'false') return 'boolean'
          if (right.type === 'none') return 'None'
          // If reassigned to something else (e.g. function), stop looking
          return null
        }
      }
    }

    // If name is reassigned in any other way, bail out
    if (sibling.type === 'function_definition' || sibling.type === 'class_definition') {
      const defName = sibling.childForFieldName('name')
      if (defName?.text === name) return null
    }

    sibling = sibling.previousNamedSibling
    lookback++
  }

  return null
}
