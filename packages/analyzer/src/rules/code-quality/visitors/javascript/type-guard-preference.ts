import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects boolean-returning functions that perform instanceof/typeof checks
 * but don't use a type predicate return type (`x is T`).
 * Suggesting `(x): x is Foo => ...` makes the narrowing explicit for callers.
 */

function hasTypePredicate(node: SyntaxNode): boolean {
  // TypeScript type predicates appear as `return_type` with `type_predicate` node
  const returnType = node.childForFieldName('return_type')
  if (!returnType) return false
  return returnType.text.includes(' is ')
}

function returnTypeIsBoolish(node: SyntaxNode): boolean {
  const returnType = node.childForFieldName('return_type')
  if (!returnType) return true // no annotation — could be boolean inferred
  const t = returnType.text.replace(/^:\s*/, '').trim()
  return t === 'boolean' || t === 'Boolean'
}

function containsTypeNarrowingCheck(bodyNode: SyntaxNode): boolean {
  let found = false

  function walk(n: SyntaxNode) {
    if (found) return
    if (n.type === 'binary_expression') {
      const op = n.children.find((c) => c.type === 'instanceof' || c.text === 'instanceof')
      if (op) { found = true; return }
    }
    if (n.type === 'binary_expression') {
      const left = n.childForFieldName('left')
      const op = n.children.find((c) => c.text === '===')
      if (left?.type === 'unary_expression' && left.children.some((c) => c.text === 'typeof') && op) {
        found = true
        return
      }
    }
    // Also check: typeof x === 'string' pattern
    if (n.type === 'unary_expression') {
      const op = n.child(0)
      if (op?.text === 'typeof') {
        // Parent should be a comparison
        const parent = n.parent
        if (parent?.type === 'binary_expression') {
          found = true
          return
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }

  walk(bodyNode)
  return found
}

function hasBooleanReturn(bodyNode: SyntaxNode): boolean {
  let found = false

  function walk(n: SyntaxNode) {
    if (found) return
    if (n.type === 'return_statement') {
      const val = n.namedChildren[0]
      if (!val) return
      if (val.type === 'true' || val.type === 'false') { found = true; return }
      // return x instanceof Foo or return typeof x === 'string'
      if (val.type === 'binary_expression') {
        const hasInstanceof = val.children.some((c) => c.text === 'instanceof')
        const hasBoolOp = val.children.some((c) => c.text === '===' || c.text === '!==')
        if (hasInstanceof || hasBoolOp) { found = true; return }
      }
      if (val.type === 'parenthesized_expression') { found = true; return }
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }

  walk(bodyNode)
  return found
}

export const typeGuardPreferenceVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/type-guard-preference',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['function_declaration', 'arrow_function'],
  visit(node, filePath, sourceCode) {
    // Skip if already uses a type predicate
    if (hasTypePredicate(node)) return null

    // Only functions that return boolean
    if (!returnTypeIsBoolish(node)) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Must contain instanceof or typeof check
    if (!containsTypeNarrowingCheck(body)) return null

    // Must return a boolean-ish expression
    if (!hasBooleanReturn(body)) return null

    // Only flag functions with a single return statement containing a typeof/instanceof check.
    // Functions with multiple returns or complex logic are classification functions, not type guards.
    const returnStatements: SyntaxNode[] = []
    function collectReturns(n: SyntaxNode) {
      if (n.type === 'return_statement') returnStatements.push(n)
      // Don't recurse into nested functions
      if (n.type === 'arrow_function' || n.type === 'function_declaration' || n.type === 'function_expression' || n.type === 'function') return
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collectReturns(child)
      }
    }
    collectReturns(body)
    if (returnStatements.length > 1) return null

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text ?? 'function'

    // Only flag functions that look like type guard candidates:
    // - Named with is/has/check prefix (convention for type guards)
    // - Or very small functions (≤3 statements) whose primary purpose is the type check
    const isGuardName = /^(is|has|check|assert)[A-Z]/.test(name)
    if (!isGuardName) {
      const statements = body.namedChildren.filter((c) =>
        c.type.includes('statement') || c.type.includes('declaration') || c.type === 'return_statement'
      )
      if (statements.length > 3) return null
    }

    return makeViolation(
      this.ruleKey,
      node,
      filePath,
      'low',
      'Type guard preference',
      `\`${name}\` checks types with \`instanceof\`/\`typeof\` but doesn't use a type predicate return type — use \`(x): x is T\` to make the narrowing explicit.`,
      sourceCode,
      'Change the return type to a type predicate: `(param): param is Type => ...`.',
    )
  },
}
