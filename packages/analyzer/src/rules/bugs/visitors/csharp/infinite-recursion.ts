import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Unconditional self-recursion that always overflows the stack:
 *   - a method whose first/only statement calls itself with its own
 *     parameters verbatim (`int Load(int id) { return Load(id); }`) —
 *     same-arity check excludes idiomatic overload delegation
 *     (`Parse(s)` → `Parse(s, culture)`)
 *   - a property that reads itself (`public string Name => Name;` or
 *     `get { return Name; }`) — the classic missing-backing-field typo
 */
function selfCallWithOwnParams(expr: SyntaxNode, methodName: string, paramNames: string[]): boolean {
  if (expr.type !== 'invocation_expression') return false
  const fn = expr.childForFieldName('function')
  if (fn?.type !== 'identifier' || fn.text !== methodName) return false
  const args = expr.childForFieldName('arguments')?.namedChildren.filter(Boolean) ?? []
  if (args.length !== paramNames.length) return false
  return args.every((a, i) => a!.text === paramNames[i])
}

export const csharpInfiniteRecursionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/infinite-recursion',
  languages: ['csharp'],
  nodeTypes: ['method_declaration', 'property_declaration'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')?.text
    if (!name) return null

    if (node.type === 'property_declaration') {
      // Expression-bodied property: `public int Age => Age;`. Only an
      // `arrow_expression_clause` is an expression body; an auto-property
      // initializer (`public Color Color { get; set; } = Color.Default;`) also
      // surfaces on the `value` field — as a `member_access_expression` whose
      // leading type identifier can coincide with the property name — and that
      // is a backing-field read, not self-recursion.
      const arrow = node.childForFieldName('value')
      const arrowExpr = arrow?.type === 'arrow_expression_clause' ? arrow.namedChildren[0] : null
      if (arrowExpr?.type === 'identifier' && arrowExpr.text === name) {
        return makeViolation(
          this.ruleKey, node, filePath, 'critical',
          'Infinite recursion',
          `Property \`${name}\` returns itself — reading it recurses until StackOverflowException.`,
          sourceCode,
          'Return the backing field (or use an auto-property) instead of the property itself.',
        )
      }
      // Block-bodied getter: `get { return Name; }`
      const accessors = node.childForFieldName('accessors')
      const getter = accessors?.namedChildren.find((c) => c?.type === 'accessor_declaration' && c.children.some((k) => k?.type === 'get'))
      const getterBody = getter?.childForFieldName('body')
      if (getterBody?.type === 'block') {
        const stmts = getterBody.namedChildren.filter((c) => c && c.type !== 'comment')
        const first = stmts[0]
        if (stmts.length === 1 && first?.type === 'return_statement' && first.namedChildren[0]?.type === 'identifier' && first.namedChildren[0]!.text === name) {
          return makeViolation(
            this.ruleKey, getter!, filePath, 'critical',
            'Infinite recursion',
            `The getter of \`${name}\` returns the property itself — reading it recurses until StackOverflowException.`,
            sourceCode,
            'Return the backing field instead of the property itself.',
          )
        }
      }
      return null
    }

    // Method: first statement is an unconditional self-call with the same arguments
    const body = node.childForFieldName('body')
    if (!body || body.type !== 'block') return null
    const paramNames = (node.childForFieldName('parameters')?.namedChildren ?? [])
      .filter((c) => c?.type === 'parameter')
      .map((c) => c!.childForFieldName('name')?.text ?? '')

    const statements = body.namedChildren.filter((c) => c && c.type !== 'comment')
    const first = statements[0]
    if (!first) return null

    const candidate =
      first.type === 'expression_statement' ? first.namedChildren[0]
      : first.type === 'return_statement' ? first.namedChildren[0]
      : null
    if (!candidate || !selfCallWithOwnParams(candidate, name, paramNames)) return null

    return makeViolation(
      this.ruleKey, first, filePath, 'critical',
      'Infinite recursion',
      `\`${name}\` unconditionally calls itself with its own arguments — this always throws StackOverflowException.`,
      sourceCode,
      'Add a base case before the recursive call, or call the intended overload.',
    )
  },
}
