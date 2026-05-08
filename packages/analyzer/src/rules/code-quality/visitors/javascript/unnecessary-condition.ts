import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * True if `expr` is an identifier whose binding is a `let`
 * declaration (rather than `const`). `let` variables can be
 * reassigned — typically from a closure (effect cleanup,
 * event handler, async cancel flag) — so a "the type is
 * literally `false`" report from the type query should not
 * be treated as always-falsy.
 */
function isLetBoundIdentifier(expr: SyntaxNode): boolean {
  if (expr.type !== 'identifier') return false
  const name = expr.text
  // Walk up to find the binding's declaration in any enclosing scope.
  let cursor: SyntaxNode | null = expr.parent
  while (cursor) {
    if (cursor.type === 'statement_block' || cursor.type === 'function_body' ||
        cursor.type === 'program' || cursor.type === 'arrow_function' ||
        cursor.type === 'function_declaration' || cursor.type === 'function_expression' ||
        cursor.type === 'method_definition') {
      // Search this scope for a `let <name> = ...` declaration.
      for (let i = 0; i < cursor.namedChildCount; i++) {
        const stmt = cursor.namedChild(i)
        if (!stmt) continue
        if (stmt.type !== 'lexical_declaration' && stmt.type !== 'variable_declaration') continue
        const kindToken = stmt.children[0]
        const isLet = kindToken?.text === 'let' || stmt.type === 'variable_declaration'
        if (!isLet) continue
        for (const decl of stmt.namedChildren) {
          if (decl.type !== 'variable_declarator') continue
          const declName = decl.childForFieldName('name')
          if (declName?.type === 'identifier' && declName.text === name) return true
        }
      }
    }
    cursor = cursor.parent
  }
  return false
}

/**
 * Detect: Conditional check on a value whose type makes it always truthy or always falsy.
 * Corresponds to @typescript-eslint/no-unnecessary-condition.
 */
export const unnecessaryConditionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-condition',
  languages: TS_LANGUAGES,
  nodeTypes: ['if_statement', 'ternary_expression'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    let condition: typeof node | null = null
    if (node.type === 'ternary_expression') {
      condition = node.namedChildren[0] ?? null
    } else {
      condition = node.childForFieldName('condition')
    }
    if (!condition) return null

    // Unwrap parentheses
    let expr = condition
    if (expr.type === 'parenthesized_expression' && expr.namedChildren[0]) {
      expr = expr.namedChildren[0]
    }

    // Skip if it's already a comparison or logical expression
    if (expr.type === 'binary_expression' || expr.type === 'unary_expression') return null
    // Skip call expressions — type query may return the object type instead of the return type
    if (expr.type === 'call_expression') return null

    const typeStr = typeQuery.getTypeAtPosition(
      filePath,
      expr.startPosition.row,
      expr.startPosition.column,
    )
    if (!typeStr) return null

    // Skip any/unknown
    if (typeStr === 'any' || typeStr === 'unknown') return null

    // For literal-type results (`'true'` / `'false'`), skip when
    // the identifier is `let`-bound. The type query reports the
    // initializer's literal type, but `let` variables are
    // routinely reassigned from closures (effect cleanup, async
    // cancel flags, event handlers) that the checker can't trace.
    if ((typeStr === 'true' || typeStr === 'false') && isLetBoundIdentifier(expr)) {
      return null
    }

    // Always truthy types
    const alwaysTruthy = new Set(['object', 'Function', 'symbol', 'RegExp'])
    if (typeStr === 'true' || alwaysTruthy.has(typeStr)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Condition is always truthy',
        `Condition of type \`${typeStr}\` is always truthy — this check is unnecessary.`,
        sourceCode,
        'Remove the condition or simplify the code.',
      )
    }

    // Always falsy types
    if (typeStr === 'false' || typeStr === 'never' || typeStr === 'void') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Condition is always falsy',
        `Condition of type \`${typeStr}\` is always falsy — the code inside will never execute.`,
        sourceCode,
        'Remove the dead code or fix the condition.',
      )
    }

    return null
  },
}
