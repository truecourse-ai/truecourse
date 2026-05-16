import type { Node as SyntaxNode } from 'web-tree-sitter'
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
  // Require an explicit `boolean` (or `Boolean`) return annotation. Without
  // one we can't reliably tell a type-guard candidate from a React component
  // or any other plain function that happens to contain a `typeof` check.
  const returnType = node.childForFieldName('return_type')
  if (!returnType) return false
  const t = returnType.text.replace(/^:\s*/, '').trim()
  return t === 'boolean' || t === 'Boolean'
}

const FUNCTION_NODE_TYPES = new Set([
  'arrow_function',
  'function_declaration',
  'function_expression',
  'function',
  'method_definition',
  'generator_function',
  'generator_function_declaration',
])

function containsTypeNarrowingCheck(bodyNode: SyntaxNode): boolean {
  let found = false

  function walk(n: SyntaxNode) {
    if (found) return
    // Don't recurse into nested functions — their checks aren't part of this guard.
    if (n !== bodyNode && FUNCTION_NODE_TYPES.has(n.type)) return
    if (n.type === 'binary_expression') {
      const op = n.children.find((c) => c.type === 'instanceof' || c.text === 'instanceof')
      if (op) { found = true; return }
      const left = n.childForFieldName('left')
      const right = n.childForFieldName('right')
      const cmp = n.children.find((c) => c.text === '===' || c.text === '!==' || c.text === '==' || c.text === '!=')
      if (cmp) {
        const isTypeofUnary = (x: SyntaxNode | null | undefined) =>
          !!x && x.type === 'unary_expression' && x.children.some((c) => c.text === 'typeof')
        if (isTypeofUnary(left) || isTypeofUnary(right)) {
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
    if (n !== bodyNode && FUNCTION_NODE_TYPES.has(n.type)) return
    if (n.type === 'return_statement') {
      const val = n.namedChildren[0]
      if (!val) return
      if (returnsBooleanExpression(val)) { found = true; return }
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }

  // For arrow function expression bodies, `bodyNode` itself is the expression.
  if (bodyNode.type !== 'statement_block') {
    return returnsBooleanExpression(bodyNode)
  }

  walk(bodyNode)
  return found
}

function returnsBooleanExpression(val: SyntaxNode): boolean {
  if (val.type === 'true' || val.type === 'false') return true
  if (val.type === 'parenthesized_expression') {
    const inner = val.namedChildren[0]
    return inner ? returnsBooleanExpression(inner) : false
  }
  if (val.type === 'binary_expression') {
    const hasInstanceof = val.children.some((c) => c.text === 'instanceof')
    if (hasInstanceof) return true
    const cmp = val.children.some((c) => c.text === '===' || c.text === '!==' || c.text === '==' || c.text === '!=')
    if (cmp) {
      const left = val.childForFieldName('left')
      const right = val.childForFieldName('right')
      const isTypeofUnary = (x: SyntaxNode | null | undefined) =>
        !!x && x.type === 'unary_expression' && x.children.some((c) => c.text === 'typeof')
      return isTypeofUnary(left) || isTypeofUnary(right)
    }
    // Logical && / || between boolean-shaped sub-expressions
    const logical = val.children.some((c) => c.text === '&&' || c.text === '||')
    if (logical) {
      const left = val.childForFieldName('left')
      const right = val.childForFieldName('right')
      return (left ? returnsBooleanExpression(left) : false) || (right ? returnsBooleanExpression(right) : false)
    }
  }
  if (val.type === 'unary_expression') {
    const op = val.child(0)
    if (op?.text === '!') {
      const arg = val.namedChildren[0]
      return arg ? returnsBooleanExpression(arg) : false
    }
  }
  return false
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
